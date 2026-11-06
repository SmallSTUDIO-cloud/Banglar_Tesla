using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;

namespace BanglarTesla.Domain
{
    public sealed class SettingsStore
    {
        public const string SettingsKey = "banglar-tesla.settings.v1";
        private static readonly JsonSerializerSettings JsonSettings = new()
        {
            ContractResolver = new CamelCasePropertyNamesContractResolver(),
            Culture = System.Globalization.CultureInfo.InvariantCulture,
        };
        private readonly IKeyValueStorage? storage;
        private SettingsData value;

        public SettingsStore(IKeyValueStorage? storage, SettingsData? initial = null)
        {
            this.storage = storage;
            SettingsData baseline = initial ?? SettingsData.CreateDefault();
            value = SettingsData.Sanitize(LoadRaw(), baseline);
        }

        public SettingsData Value => value;
        public event Action<SettingsData>? Changed;

        private SettingsData? LoadRaw()
        {
            if (storage is null) return null;
            try
            {
                string? json = storage.GetItem(SettingsKey);
                return string.IsNullOrEmpty(json) ? null : JsonConvert.DeserializeObject<SettingsData>(json, JsonSettings);
            }
            catch { return null; }
        }

        public SettingsData Snapshot() => JsonConvert.DeserializeObject<SettingsData>(JsonConvert.SerializeObject(value, JsonSettings), JsonSettings)
            ?? SettingsData.CreateDefault();

        public void Update(Action<SettingsData> mutate)
        {
            SettingsData next = Snapshot();
            mutate(next);
            next = SettingsData.Sanitize(next, value);
            string before = JsonConvert.SerializeObject(value, JsonSettings);
            string after = JsonConvert.SerializeObject(next, JsonSettings);
            if (before == after) return;
            value = next;
            Persist(after);
            Changed?.Invoke(value);
        }

        public void Reset()
        {
            value = SettingsData.CreateDefault();
            Persist(JsonConvert.SerializeObject(value, JsonSettings));
            Changed?.Invoke(value);
        }

        private void Persist(string json)
        {
            if (storage is null) return;
            try { storage.SetItem(SettingsKey, json); }
            catch { /* Settings remain valid in memory when storage is unavailable. */ }
        }
    }
}
