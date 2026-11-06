using System;
using Newtonsoft.Json;

namespace BanglarTesla.Domain.Maps
{
    public static class MapJson
    {
        private static readonly JsonSerializerSettings Settings = new() { ObjectCreationHandling = ObjectCreationHandling.Replace };

        public static MapDataset Deserialize(string json)
        {
            if (string.IsNullOrWhiteSpace(json)) throw new ArgumentException("Map JSON is empty.", nameof(json));
            MapDataset dataset = JsonConvert.DeserializeObject<MapDataset>(json, Settings) ?? throw new JsonSerializationException("Map JSON produced no dataset.");
            var errors = dataset.Validate();
            if (errors.Count > 0) throw new JsonSerializationException("Invalid map dataset: " + string.Join(" ", errors));
            return dataset;
        }
    }
}
