/** The two axes every build is filed under. Both are closed sets, validated on the way in. */

export const PLATFORMS = ["IOS", "ANDROID"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const CHANNELS = ["PRODUCTION", "DEVELOPMENT"] as const;
export type Channel = (typeof CHANNELS)[number];

export function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && (PLATFORMS as readonly string[]).includes(value);
}

export function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && (CHANNELS as readonly string[]).includes(value);
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  IOS: "iOS",
  ANDROID: "Android",
};

export const PLATFORM_DEVICE_LABELS: Record<Platform, string> = {
  IOS: "iPhone & iPad",
  ANDROID: "Android",
};

export const CHANNEL_LABELS: Record<Channel, string> = {
  PRODUCTION: "Production",
  DEVELOPMENT: "Development",
};
