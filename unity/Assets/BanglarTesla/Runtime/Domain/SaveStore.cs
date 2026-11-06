using System;
using System.Globalization;
using Newtonsoft.Json;

namespace BanglarTesla.Domain
{
    public interface IKeyValueStorage
    {
        string? GetItem(string key);
        void SetItem(string key, string value);
        void RemoveItem(string key);
    }

    public sealed class LoadResult
    {
        public ProgressData? Progress;
        public bool Recovered;
        public string? Error;
    }

    /// <summary>Crash-tolerant save policy; platform storage is injected by the Unity adapter.</summary>
    public sealed class SaveStore
    {
        private readonly IKeyValueStorage? storage;
        private double lastWrite;
        private bool dirty;

        public SaveStore(IKeyValueStorage? storage) => this.storage = storage;

        public bool HasSave()
        {
            if (storage is null) return false;
            try { return storage.GetItem(GameProgress.SaveKey) is not null; }
            catch { return false; }
        }

        public LoadResult Load(double now)
        {
            if (storage is null) return new LoadResult();
            string? raw;
            try { raw = storage.GetItem(GameProgress.SaveKey); }
            catch { return new LoadResult { Error = "storage-unavailable" }; }
            if (string.IsNullOrEmpty(raw)) return new LoadResult();
            try
            {
                return new LoadResult { Progress = GameProgress.DeserializeAndMigrate(raw, now) };
            }
            catch (Exception error)
            {
                try { storage.SetItem(GameProgress.SaveKey + ".corrupt." + now.ToString("0", CultureInfo.InvariantCulture), raw.Substring(0, Math.Min(raw.Length, 20_000))); }
                catch { /* Best-effort forensic copy. */ }
                try
                {
                    string? backup = storage.GetItem(GameProgress.BackupKey);
                    if (!string.IsNullOrEmpty(backup))
                        return new LoadResult { Progress = GameProgress.DeserializeAndMigrate(backup, now), Recovered = true, Error = error.Message };
                }
                catch { /* Fall through to a clean new-game decision by the caller. */ }
                return new LoadResult { Error = error.Message };
            }
        }

        public bool Save(ProgressData progress, double now)
        {
            if (storage is null) return false;
            try
            {
                string? previous = storage.GetItem(GameProgress.SaveKey);
                if (!string.IsNullOrEmpty(previous)) storage.SetItem(GameProgress.BackupKey, previous);
                progress.Version = GameProgress.SaveVersion;
                progress.UpdatedAt = now;
                storage.SetItem(GameProgress.SaveKey, JsonConvert.SerializeObject(progress, Formatting.None));
                lastWrite = now;
                dirty = false;
                return true;
            }
            catch { return false; }
        }

        public bool Autosave(ProgressData progress, double now, double intervalMilliseconds = 20_000.0)
        {
            if (now - lastWrite < intervalMilliseconds)
            {
                dirty = true;
                return false;
            }
            return Save(progress, now);
        }

        public void Flush(ProgressData progress, double now)
        {
            if (dirty) Save(progress, now);
        }

        public void Clear()
        {
            if (storage is null) return;
            try { storage.RemoveItem(GameProgress.SaveKey); storage.RemoveItem(GameProgress.BackupKey); }
            catch { /* Storage may be unavailable in private browsing. */ }
        }
    }
}
