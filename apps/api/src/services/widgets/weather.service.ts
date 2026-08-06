import { db } from "@funtush/database";
import axios from "axios";

interface WeatherWidgetPayload {
    enabled: boolean;
}
interface WeatherPayload {
    city_name: string;
    cnt: number;
}


export const updateWeatherWidgetService = async (
    agencyUserId: string,
    data: WeatherWidgetPayload
) => {
    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId,
        },
        select: {
            agencyId: true,
        },
    });

    if (!agencyUser) {
        throw new Error("Agency user not found.");
    }

    const agency = await db.agency.findUnique({
        where: {
            id: agencyUser.agencyId,
        },
        include: {
            tier: true,
        },
    });

    if (!agency) {
        throw new Error("Agency not found.");
    }

    // if (!["MEDIUM", "LARGE"].includes(agency.tier.name)) {
    //     throw new Error(
    //         "Weather widget is available only for Medium and Large plans."
    //     );
    // }

    return await db.agencyProfile.update({
        where: {
            agencyId: agency.id,
        },
        data: {
            weatherWidgetEnabled: data.enabled,
        },
        select: {
            id: true,
            weatherWidgetEnabled: true,
        },
    });
};

export const weatherApiService = async (
    data: WeatherPayload
) => {
    const { city_name, cnt } = data;

    const api_key = process.env.WEATHER_API_KEY;
    if (!api_key) {
        throw new Error("Weather API key is not configured.");
    }

    const [currentWeather, forecastWeather] = await Promise.all([
        axios.get(
            "https://api.openweathermap.org/data/2.5/weather",
            {
                params: {
                    q: city_name,
                    appid: api_key,
                    units: "metric",
                },
            }
        ),
        axios.get(
            "https://api.openweathermap.org/data/2.5/forecast",
            {
                params: {
                    q: city_name,
                    appid: api_key,
                    cnt: cnt,
                    units: "metric",
                },
            }
        ),
    ]);

    const convertToNepalDateTime = (utcDateTime: string): string => {
        return new Date(utcDateTime + " UTC").toLocaleString("en-GB", {
            timeZone: "Asia/Kathmandu",
            hour12: true,
        });
    };

    return {
        city: currentWeather.data.name,
        country: currentWeather.data.sys.country,
        current: {
            weather: currentWeather.data.weather[0].description,
            temperature: currentWeather.data.main.temp,
            feelsLike: currentWeather.data.main.feels_like,
            humidity: currentWeather.data.main.humidity,
            pressure: currentWeather.data.main.pressure,
            visibility: currentWeather.data.visibility,
            windSpeed: currentWeather.data.wind.speed,
        },
        forecast_combined_1_per_5days: forecastWeather.data.list
            .filter((item: { dt_txt: string }) => {
                return item.dt_txt.endsWith("06:00:00")
            })
            .slice(0, cnt)
            .map((item: {
                dt_txt: string;
                main: {
                    temp: number;
                    feels_like: number;
                    humidity: number;
                };
                weather: {
                    description: string;
                    icon: string;
                }[];
                wind: {
                    speed: number;
                };
            }) => ({
                date_AM: convertToNepalDateTime(item.dt_txt),
                weather: item.weather[0].description,
                temperature: item.main.temp,
                feelsLike: item.main.feels_like,
                humidity: item.main.humidity,
                windSpeed: item.wind.speed,
            })),
        forecast_of_5_days_3_hours_interval: forecastWeather.data.list.map(
            (item: {
                dt_txt: string;
                main: {
                    temp: number;
                    feels_like: number;
                    humidity: number;
                };
                weather: {
                    description: string;
                    icon: string;
                }[];
                wind: {
                    speed: number;
                };
            }
            ) => ({
                date: convertToNepalDateTime(item.dt_txt),
                weather: item.weather[0].description,
                temperature: item.main.temp,
                feelsLike: item.main.feels_like,
                humidity: item.main.humidity,
                windSpeed: item.wind.speed,
            })
        ),
    };

};