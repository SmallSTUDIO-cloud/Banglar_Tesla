mergeInto(LibraryManager.library, {
  BT_StorageGet: function (keyPointer) {
    try {
      var key = UTF8ToString(keyPointer);
      var value = window.localStorage.getItem(key);
      if (value === null) return 0;
      var size = lengthBytesUTF8(value) + 1;
      var output = _malloc(size);
      stringToUTF8(value, output, size);
      return output;
    } catch (error) {
      return 0;
    }
  },
  BT_StorageSet: function (keyPointer, valuePointer) {
    try {
      window.localStorage.setItem(UTF8ToString(keyPointer), UTF8ToString(valuePointer));
      return 1;
    } catch (error) {
      return 0;
    }
  },
  BT_StorageRemove: function (keyPointer) {
    try {
      window.localStorage.removeItem(UTF8ToString(keyPointer));
      return 1;
    } catch (error) {
      return 0;
    }
  },
  BT_StorageFree: function (pointer) {
    _free(pointer);
  }
});
