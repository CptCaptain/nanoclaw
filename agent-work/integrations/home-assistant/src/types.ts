/**
 * Home Assistant REST API Types
 * Based on https://developers.home-assistant.io/docs/api/rest/
 */

export interface HomeAssistantConfig {
  baseUrl: string;
  accessToken: string;
}

export interface EntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
  last_updated: string;
  context: {
    id: string;
    parent_id: string | null;
    user_id: string | null;
  };
}

export interface ServiceCallData {
  entity_id?: string | string[];
  [key: string]: any;
}

export interface ServiceDomain {
  domain: string;
  services: Record<string, ServiceDefinition>;
}

export interface ServiceDefinition {
  name: string;
  description: string;
  fields: Record<string, FieldDefinition>;
  target?: {
    entity?: Array<{ domain: string[] }>;
    device?: Array<{ integration: string }>;
  };
}

export interface FieldDefinition {
  description: string;
  example?: any;
  required?: boolean;
  selector?: any;
}

export interface HistoryState {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
  last_updated: string;
}

export interface LogbookEntry {
  when: string;
  name: string;
  message?: string;
  domain?: string;
  entity_id?: string;
}

export interface CalendarEvent {
  start: { dateTime: string } | { date: string };
  end: { dateTime: string } | { date: string };
  summary: string;
  description?: string;
  location?: string;
  uid?: string;
}

export interface TemplateResult {
  result: string;
}

export interface ErrorLogEntry {
  message: string;
  level: string;
  source: string;
  timestamp: string;
}

// Common light attributes
export interface LightAttributes {
  brightness?: number;
  color_temp?: number;
  rgb_color?: [number, number, number];
  hs_color?: [number, number];
  xy_color?: [number, number];
  effect?: string;
  supported_features?: number;
  friendly_name?: string;
}

// Common climate attributes
export interface ClimateAttributes {
  temperature?: number;
  target_temp_low?: number;
  target_temp_high?: number;
  current_temperature?: number;
  hvac_mode?: 'off' | 'heat' | 'cool' | 'heat_cool' | 'auto' | 'dry' | 'fan_only';
  preset_mode?: string;
  fan_mode?: string;
  humidity?: number;
  friendly_name?: string;
}

// Common sensor attributes
export interface SensorAttributes {
  unit_of_measurement?: string;
  device_class?: string;
  state_class?: string;
  friendly_name?: string;
}

export type EntityAttributes = LightAttributes | ClimateAttributes | SensorAttributes | Record<string, any>;

export interface HomeAssistantError {
  message: string;
}
