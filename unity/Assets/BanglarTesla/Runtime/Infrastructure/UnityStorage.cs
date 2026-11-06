using System;
using BanglarTesla.Domain;
using UnityEngine;
#if UNITY_WEBGL && !UNITY_EDITOR
using System.Runtime.InteropServices;
#endif

namespace BanglarTesla.Infrastructure
{
    public sealed class PlayerPrefsStorage : IKeyValueStorage
    {
        public string? GetItem(string key) => PlayerPrefs.HasKey(key) ? PlayerPrefs.GetString(key) : null;
        public void SetItem(string key, string value)
        {
            PlayerPrefs.SetString(key, value);
            PlayerPrefs.Save();
        }
        public void RemoveItem(string key)
        {
            PlayerPrefs.DeleteKey(key);
            PlayerPrefs.Save();
        }
    }

#if UNITY_WEBGL && !UNITY_EDITOR
    public sealed class WebLocalStorage : IKeyValueStorage
    {
        [DllImport("__Internal")] private static extern IntPtr BT_StorageGet(string key);
        [DllImport("__Internal")] private static extern int BT_StorageSet(string key, string value);
        [DllImport("__Internal")] private static extern int BT_StorageRemove(string key);
        [DllImport("__Internal")] private static extern void BT_StorageFree(IntPtr pointer);

        public string? GetItem(string key)
        {
            IntPtr pointer = BT_StorageGet(key);
            if (pointer == IntPtr.Zero) return null;
            try { return Marshal.PtrToStringUTF8(pointer); }
            finally { BT_StorageFree(pointer); }
        }

        public void SetItem(string key, string value)
        {
            if (BT_StorageSet(key, value) == 0) throw new InvalidOperationException("Browser localStorage is unavailable or full.");
        }

        public void RemoveItem(string key)
        {
            if (BT_StorageRemove(key) == 0) throw new InvalidOperationException("Browser localStorage is unavailable.");
        }
    }
#endif

    public static class UnityStorage
    {
        public static IKeyValueStorage Create()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            return new WebLocalStorage();
#else
            return new PlayerPrefsStorage();
#endif
        }
    }
}
