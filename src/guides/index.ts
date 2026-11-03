import type { Platform } from "../core/model.js";
import { braze } from "./braze.js";
import { iterable } from "./iterable.js";
import { klaviyo } from "./klaviyo.js";
import type { PlatformGuide } from "./types.js";

export const GUIDES: Record<Platform, PlatformGuide> = { braze, klaviyo, iterable };
