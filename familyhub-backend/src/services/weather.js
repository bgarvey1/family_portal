// Weather service using Open-Meteo (free, no API key needed)
// Caches results for 30 minutes per location

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

// In-memory cache: key = "city,state" → { data, timestamp }
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// WMO Weather interpretation codes → human-readable descriptions
const WEATHER_CODES = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

function describeWeatherCode(code) {
  return WEATHER_CODES[code] || 'Unknown';
}

async function geocode(cityName) {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(cityName)}&count=1&language=en&format=json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Geocoding failed: HTTP ${r.status}`);
  const data = await r.json();
  if (!data.results || data.results.length === 0) return null;
  const loc = data.results[0];
  return {
    latitude: loc.latitude,
    longitude: loc.longitude,
    name: loc.name,
    admin1: loc.admin1 || '',
    country: loc.country || '',
  };
}

async function getWeatherForCoords(latitude, longitude) {
  const url = `${FORECAST_URL}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weathercode&daily=temperature_2m_max,temperature_2m_min,weathercode&temperature_unit=fahrenheit&timezone=auto`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Weather API failed: HTTP ${r.status}`);
  const data = await r.json();

  // Build 7-day forecast
  const forecast = [];
  const daily = data.daily;
  if (daily && daily.time) {
    for (let i = 0; i < daily.time.length && i < 7; i++) {
      forecast.push({
        date: daily.time[i],
        high: Math.round(daily.temperature_2m_max[i]),
        low: Math.round(daily.temperature_2m_min[i]),
        weatherCode: daily.weathercode[i],
        description: describeWeatherCode(daily.weathercode[i]),
      });
    }
  }

  return {
    temperature: data.current?.temperature_2m,
    weatherCode: data.current?.weathercode,
    description: describeWeatherCode(data.current?.weathercode),
    unit: 'F',
    forecast,
  };
}

async function getWeatherForCity(city, state) {
  const key = `${city},${state}`.toLowerCase();

  // Check cache
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  // Geocode using just the city name (Open-Meteo doesn't handle "City STATE" well)
  const geo = await geocode(city);
  if (!geo) return null;

  // Fetch weather
  const weather = await getWeatherForCoords(geo.latitude, geo.longitude);
  const result = {
    city: geo.name,
    state: geo.admin1,
    country: geo.country,
    latitude: geo.latitude,
    longitude: geo.longitude,
    ...weather,
  };

  // Cache it
  cache.set(key, { data: result, timestamp: Date.now() });
  return result;
}

module.exports = {
  getWeatherForCity,
  geocode,
  getWeatherForCoords,
};
