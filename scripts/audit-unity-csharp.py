#!/usr/bin/env python3
"""Heuristic static audit for the Unity C# sources.

This is NOT a compiler. It parses C# with tree-sitter and reports identifiers
that look like they should resolve against project types but do not, plus
member accesses on values whose declared type is a project type.

Its purpose is to catch the defect classes a compiler reports first when no
Unity install or .NET SDK is available. Findings still need human review; the
tool cannot prove that Unity APIs are used correctly.

Design choices that keep it honest:
  * Receiver types are resolved inside the enclosing type only (fields, then
    parameters/locals of the enclosing method), never by global name search.
  * Types with an external base class (MonoBehaviour, VisualElement, ...) are
    treated as opaque for member checks, because inherited members are unknown.
  * Unknown type names are reported for human triage rather than auto-allowed.

Usage:
    python3 scripts/audit-unity-csharp.py [--verbose]
"""

from __future__ import annotations

import collections
import pathlib
import sys

NAMESPACE_NODES = {"namespace_declaration", "file_scoped_namespace_declaration"}
TYPE_NODES = {
    "class_declaration",
    "struct_declaration",
    "interface_declaration",
    "enum_declaration",
    "record_declaration",
}
MEMBER_NODES = {
    "method_declaration",
    "property_declaration",
    "field_declaration",
    "event_declaration",
    "event_field_declaration",
    "constructor_declaration",
    "enum_member_declaration",
    "delegate_declaration",
    "indexer_declaration",
}
# Parent node kinds where an expression must produce a value.
VALUE_POSITION_PARENTS = {
    "argument", "binary_expression", "prefix_unary_expression", "postfix_unary_expression",
    "assignment_expression", "variable_declarator", "return_statement", "equals_value_clause",
    "element_access_expression", "cast_expression", "conditional_expression", "interpolation",
    "member_access_expression", "parenthesized_expression", "initializer_expression",
}
INHERITED_MEMBERS = {"Equals", "GetHashCode", "GetType", "ToString", "MemberwiseClone"}

# Types supplied by Unity, Newtonsoft, NUnit or the BCL. Curated for this
# project: extend only when a dependency is genuinely added.
KNOWN_EXTERNAL_TYPES = set("""
Action Application Array AssetDatabase AudioClip AudioSource Behaviour BinaryReader BinaryWriter
BitConverter Boolean BoxCollider BuiltinRenderTextureType Byte Camera CancellationToken Char
Collider ColliderData Color Color32 Component Console Convert CultureInfo CustomStyleProperty
Debug Decimal Delegate Dictionary DllImport Double EditorApplication EditorBuildSettings
EditorBuildSettingsScene EditorSceneManager EditorUtility Enum Enumerable Environment Event
Exception File FileInfo FileNotFoundException Float Func GameObject Graphics GraphicsSettings Greater Guid
HashSet IComparable IConvertible IDictionary IEnumerable IEquatable IFormatProvider IList
Image IndexFormat Input Int16 Int32 Int64 IntPtr Is JArray JObject JsonConvert
JsonProperty JsonPropertyAttribute JsonReaderException JsonSerializationException
JsonSerializer JsonSerializerSettings KeyValuePair Label LayerMask Length Less Light
LightShadows LightType List Long Marshal Material Math Mathf Matrix4x4 MemberSerialization
Mesh MeshFilter MeshRenderer MenuItem MethodImpl MonoBehaviour More NullReferenceException
Object Int Integer Path Pixels Plane PlayerPrefs PrimitiveType Property Quaternion Random
Range Rect RenderSettings RenderTexture Renderer RequireComponent Resources SerializeField
Serializable SerializeReference SerializedObject SerializedProperty Shader ShadowCastingMode Single Slider SphereCollider Sprite
String StringBuilder StyleLength StyleFloat SuppressMessage Tbmp Test TextAsset Texture2D
Time Toggle Transform Type UIDocument UIElements UIRenderer UIShader Uri Value Vector2
Vector2Int Vector3 Vector3Int Vector4 VertexAttribute VertexAttributeDescriptor
VisualElement WaitForSeconds WebGL Stopwatch Task Thread InvalidOperationException
ArgumentNullException ArgumentException ArgumentOutOfRangeException NotSupportedException
IDisposable ICloneable ICollection IReadOnlyDictionary IReadOnlyList ISet SortedDictionary
Queue Stack Tuple ValueTuple Span Memory Stream Directory StreamReader StreamWriter Encoding
AddComponent Attribute AttributeUsage Header Tooltip ContextMenu DisallowMultipleComponent
HideInInspector Space SerializeInPlace LengthComparison EqualsComparison
Button CamelCasePropertyNamesContractResolver Comparison Font Gamepad JProperty JToken Key
Keyboard PanelSettings PointerCancelEvent PointerDownEvent PointerMoveEvent PointerUpEvent
Regex Scene StyleSheet UniversalRenderPipelineAsset UniversalRendererData PanelScaleMode
PanelScreenMatchMode ThemeStyleSheet PickingMode
""".split())

PREDEFINED = {
    "bool", "byte", "sbyte", "char", "decimal", "double", "float", "int", "uint",
    "long", "ulong", "short", "ushort", "object", "string", "void", "dynamic",
}


def load_parser():
    try:
        from tree_sitter import Language, Parser
        import tree_sitter_c_sharp
    except ImportError:
        print("tree-sitter missing; run: pip install tree-sitter tree-sitter-c-sharp", file=sys.stderr)
        raise SystemExit(2)
    return Parser(Language(tree_sitter_c_sharp.language()))


def text(source: bytes, node) -> str:
    return source[node.start_byte:node.end_byte].decode("utf-8", "replace")


def walk(node):
    stack = [node]
    while stack:
        current = stack.pop()
        yield current
        stack.extend(current.children)


def declaring_namespace(source: bytes, node) -> str:
    """Fully qualified enclosing namespace of a declaration node ('' for global)."""
    parts = []
    current = node
    while current is not None:
        if current.type in NAMESPACE_NODES:
            name = current.child_by_field_name("name")
            if name is not None:
                parts.append(text(source, name))
        current = current.parent
    return ".".join(reversed(parts))


def simple_type_name(source: bytes, node) -> str | None:
    """Simple (unqualified, non-generic) type name from a type node."""
    if node is None:
        return None
    if node.type in {"tuple_type", "nullable_type"}:
        # Tuple element names and nullable wrappers are not simple type references;
        # treating them as opaque avoids false positives (e.g. WeatherKind?).
        return None
    if node.type == "identifier":
        return text(source, node)
    if node.type == "predefined_type":
        return None
    if node.type in {"array_type", "pointer_type"}:
        return simple_type_name(source, node.children[0]) if node.children else None
    if node.type == "generic_name":
        name = node.child_by_field_name("name") or (node.children[0] if node.children else None)
        return simple_type_name(source, name)
    if node.type == "qualified_name":
        name = node.child_by_field_name("name")
        return simple_type_name(source, name) if name is not None else None
    for child in node.named_children:
        resolved = simple_type_name(source, child)
        if resolved:
            return resolved
    return None


def declarators(source: bytes, field: object) -> list[tuple[str, str | None]]:
    """(name, simple type) pairs for a field/event field declaration."""
    found = []
    for child in field.children:
        if child.type != "variable_declaration":
            continue
        declared = child.child_by_field_name("type")
        type_name = simple_type_name(source, declared)
        for variable in child.children:
            if variable.type == "variable_declarator":
                name = variable.child_by_field_name("name")
                if name is not None:
                    found.append((text(source, name), type_name))
    return found


def collect_types(files) -> dict[str, dict]:
    types: dict[str, dict] = {}
    for path, (source, tree) in files.items():
        for node in walk(tree.root_node):
            if node.type not in TYPE_NODES:
                continue
            name_node = node.child_by_field_name("name")
            if name_node is None:
                continue
            name = text(source, name_node)
            entry = types.setdefault(name, {
                "members": set(), "fields": {}, "extern_base": False, "kind": node.type,
                "namespace": declaring_namespace(source, node), "void_methods": set(),
            })
            bases = [child for child in node.children if child.type == "base_list"]
            if bases and node.type is not None:
                for base in bases[0].named_children:
                    base_name = simple_type_name(source, base)
                    if base_name:
                        entry.setdefault("bases", set()).add(base_name)
            for child in walk(node):
                if child is node:
                    continue
                if child.type in ("field_declaration", "event_field_declaration"):
                    for member_name, type_name in declarators(source, child):
                        entry["members"].add(member_name)
                        entry["fields"][member_name] = type_name
                elif child.type in MEMBER_NODES:
                    member = child.child_by_field_name("name")
                    if member is None:
                        continue
                    member_name = text(source, member)
                    if child.type == "method_declaration":
                        # tree-sitter-c-sharp names a method's return type field "returns".
                        returns = child.child_by_field_name("returns") or child.child_by_field_name("type")
                        if returns is not None and text(source, returns) == "void":
                            entry["void_methods"].add(member_name)
                    entry["members"].add(member_name)
                    declared = child.child_by_field_name("type")
                    declared_name = simple_type_name(source, declared)
                    if declared_name:
                        entry["fields"][member_name] = declared_name
    # A type whose base is not itself a project type has unknown inherited members.
    for name, entry in types.items():
        for base in entry.get("bases", ()):  # noqa: SIM118
            if base not in types:
                entry["extern_base"] = True
    return types


def local_types(source: bytes, method) -> dict[str, str]:
    """Parameters and locals declared in a method body."""
    found: dict[str, str] = {}
    for child in walk(method):
        if child.type == "parameter":
            declared = child.child_by_field_name("type")
            name = child.child_by_field_name("name")
            if declared is not None and name is not None:
                simple = simple_type_name(source, declared)
                if simple:
                    found[text(source, name)] = simple
        elif child.type == "variable_declaration":
            declared = child.child_by_field_name("type")
            simple = simple_type_name(source, declared)
            if not simple:
                continue
            for variable in child.children:
                if variable.type == "variable_declarator":
                    name = variable.child_by_field_name("name")
                    if name is not None:
                        found[text(source, name)] = simple
        elif child.type == "foreach_statement":
            declared = child.child_by_field_name("type")
            left = child.child_by_field_name("left")
            simple = simple_type_name(source, declared)
            if simple and left is not None and left.type == "identifier":
                found[text(source, left)] = simple
    return found


def audit(root: pathlib.Path, verbose: bool) -> int:
    parser = load_parser()
    files = {}
    for path in sorted(root.rglob("*.cs")):
        source = path.read_bytes()
        files[path] = (source, parser.parse(source))

    syntax_errors = [p for p, (_, t) in files.items() if t.root_node.has_error]
    types = collect_types(files)
    type_names = set(types)

    unresolved = collections.Counter()
    unresolved_sites = collections.defaultdict(set)
    member_issues = set()
    invisible = set()
    void_in_value = set()

    file_usings = {}
    for path, (source, tree) in files.items():
        usings = set()
        own = ""
        for node in walk(tree.root_node):
            if node.type == "using_directive":
                # tree-sitter-c-sharp exposes the imported name as a bare child, not a field.
                for child in node.named_children:
                    if child.type in {"identifier", "qualified_name"}:
                        usings.add(text(source, child))
                        break
            elif node.type in NAMESPACE_NODES:
                own = declaring_namespace(source, node)
        file_usings[path] = (usings, own)

    for path, (source, tree) in files.items():
        for node in walk(tree.root_node):
            if node.type == "object_creation_expression":
                candidates = [node.child_by_field_name("type")]
            elif node.type == "cast_expression":
                candidates = [node.child_by_field_name("type")]
            elif node.type == "attribute":
                candidates = [node.child_by_field_name("name")]
            elif node.type == "base_list":
                candidates = list(node.named_children)
            elif node.type in {
                "variable_declaration", "parameter", "property_declaration",
                "field_declaration", "foreach_statement", "declaration_pattern",
                "catch_declaration",
            }:
                candidates = [node.child_by_field_name("type")]
            elif node.type == "method_declaration":
                candidates = [node.child_by_field_name("type"), node.child_by_field_name("returns")]
            else:
                candidates = []
            for candidate in candidates:
                name = simple_type_name(source, candidate)
                if name and name not in type_names and name not in KNOWN_EXTERNAL_TYPES and name not in PREDEFINED:
                    unresolved[name] += 1
                    unresolved_sites[name].add(path.name)
                elif name and name in type_names:
                    declared_ns = types[name]["namespace"]
                    usings, own = file_usings[path]
                    visible = (
                        declared_ns == own
                        or declared_ns in usings
                        or (own and (own == declared_ns or own.startswith(declared_ns + ".")))
                        or declared_ns == ""
                    )
                    if not visible:
                        invisible.add((path.name, name, declared_ns, own))

    # Member checks, scoped to the enclosing type.
    for file_path, node in ((p, n) for p, (source_bytes_, tree) in files.items() for n in walk(tree.root_node) if n.type in TYPE_NODES):
        source = files[file_path][0]
        name_node = node.child_by_field_name("name")
        if name_node is None:
            continue
        owner_name = text(source, name_node)
        owner = types[owner_name]
        if owner["extern_base"]:
            continue  # inherited members unknown
        fields = owner["fields"]
        for child in walk(node):
            scope = fields
            if child.type in {"method_declaration", "constructor_declaration"}:
                scope = {**fields, **local_types(source, child)}
            if child.type != "member_access_expression":
                continue
            receiver = child.child_by_field_name("expression")
            member = child.child_by_field_name("name")
            if receiver is None or member is None:
                continue
            if receiver.type == "this_expression":
                target = owner_name
            elif receiver.type == "identifier":
                target = scope.get(text(source, receiver))
            else:
                continue
            if not target or target not in type_names or types[target]["extern_base"]:
                continue
            member_name = text(source, member)
            if member_name in types[target]["members"] or member_name in INHERITED_MEMBERS:
                continue
            member_issues.add((file_path.name, owner_name, text(source, receiver), target, member_name))

    for path, (source, tree) in files.items():
        for node in walk(tree.root_node):
            if node.type != "invocation_expression":
                continue
            function = node.child_by_field_name("function")
            if function is None:
                continue
            # Resolve receiver-less calls against the enclosing type only. A global
            # name lookup mixes unrelated types and hides real findings.
            if function.type == "identifier":
                called = text(source, function)
            elif function.type == "member_access_expression":
                receiver = function.child_by_field_name("expression")
                name = function.child_by_field_name("name")
                if receiver is None or receiver.type not in {"this_expression"} or name is None:
                    continue
                called = text(source, name)
            else:
                continue
            enclosing = node.parent
            while enclosing is not None and enclosing.type not in TYPE_NODES:
                enclosing = enclosing.parent
            if enclosing is None:
                continue
            owner_name = text(source, enclosing.child_by_field_name("name"))
            owner = types.get(owner_name)
            if owner is None or called not in owner["void_methods"]:
                continue
            parent = node.parent
            if parent is not None and parent.type in VALUE_POSITION_PARENTS:
                if parent.type == "assignment_expression" and parent.child_by_field_name("right") is not node:
                    continue
                void_in_value.add((path.name, called, parent.type))

    print(f"Parsed {len(files)} C# files; {len(type_names)} project types declared.")
    print(f"Syntax errors: {len(syntax_errors)}")
    for path in syntax_errors:
        print(f"  ! {path}")

    print(f"\nVoid methods used where a value is required: {len(void_in_value)}")
    for file_name, called, context in sorted(void_in_value):
        print(f"  ! {file_name}: {called}(...) used in {context}")

    print(f"\nProject types used without a visible namespace import: {len(invisible)}")
    for file_name, name, declared_ns, own in sorted(invisible):
        print(f"  ! {file_name}: '{name}' is in '{declared_ns}' but the file namespace is '{own}'")

    print(f"\nUnresolved type names: {len(unresolved)}")
    for name, count in sorted(unresolved.items()):
        print(f"  ? {name} (x{count}) in {', '.join(sorted(unresolved_sites[name])[:3])}")

    print(f"\nMember accesses missing on the declared project type: {len(member_issues)}")
    for file_name, owner, receiver, target, member in sorted(member_issues):
        print(f"  x {file_name} [{owner}]: {receiver}.{member} -> {target} has no '{member}'")

    if verbose:
        print("\nTypes with external base (member checks skipped):")
        for name in sorted(n for n in type_names if types[n]["extern_base"]):
            print(f"  ~ {name} : {', '.join(sorted(types[name].get('bases', [])))}")

    return 1 if syntax_errors else 0


def _all_nodes(files):
    for path, (source, tree) in files.items():
        for node in walk(tree.root_node):
            yield source, node


def main() -> int:
    root = pathlib.Path(__file__).resolve().parent.parent / "unity" / "Assets" / "BanglarTesla"
    if not root.is_dir():
        print(f"Unity source directory not found: {root}", file=sys.stderr)
        return 2
    return audit(root, "--verbose" in sys.argv)


if __name__ == "__main__":
    raise SystemExit(main())
