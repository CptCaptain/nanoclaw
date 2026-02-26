/**
 * Home Assistant REST API Client
 * Implements https://developers.home-assistant.io/docs/api/rest/
 */

import type {
  HomeAssistantConfig,
  EntityState,
  ServiceCallData,
  ServiceDomain,
  HistoryState,
  LogbookEntry,
  CalendarEvent,
  TemplateResult,
  HomeAssistantError,
} from './types';

export class HomeAssistantClient {
  private baseUrl: string;
  private accessToken: string;

  constructor(config: HomeAssistantConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.accessToken = config.accessToken;
  }

  private getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(
    path: string,
    options?: { method?: string; body?: string; headers?: Record<string, string> }
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: options?.method ?? 'GET',
      body: options?.body,
      headers: {
        ...this.getHeaders(),
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ message: `HTTP ${response.status}` })) as HomeAssistantError;
      throw new Error(
        `Home Assistant API error (${response.status}): ${errorBody.message}`
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  // ==================== System Information ====================

  /**
   * Check if API is running and get basic info
   */
  async getApiStatus(): Promise<{ message: string }> {
    return this.request('/api/');
  }

  /**
   * Get current Home Assistant configuration
   */
  async getConfig(): Promise<any> {
    return this.request('/api/config');
  }

  /**
   * List all loaded components
   */
  async getComponents(): Promise<string[]> {
    return this.request('/api/components');
  }

  /**
   * Get all available services organized by domain
   */
  async getServices(): Promise<ServiceDomain[]> {
    return this.request('/api/services');
  }

  /**
   * Get event types and their listener counts
   */
  async getEvents(): Promise<Array<{ event: string; listener_count: number }>> {
    return this.request('/api/events');
  }

  /**
   * Fire an event
   * @param eventType - The event type to fire
   * @param eventData - Optional event data
   */
  async fireEvent(eventType: string, eventData?: Record<string, any>): Promise<{ message: string }> {
    return this.request(`/api/events/${eventType}`, {
      method: 'POST',
      body: eventData ? JSON.stringify(eventData) : undefined,
    });
  }

  // ==================== State Management ====================

  /**
   * Get states of all entities
   */
  async getStates(): Promise<EntityState[]> {
    return this.request('/api/states');
  }

  /**
   * Get state of a specific entity
   */
  async getState(entityId: string): Promise<EntityState> {
    return this.request(`/api/states/${entityId}`);
  }

  /**
   * Set or update state of an entity
   */
  async setState(
    entityId: string,
    state: string,
    attributes?: Record<string, any>
  ): Promise<EntityState> {
    return this.request(`/api/states/${entityId}`, {
      method: 'POST',
      body: JSON.stringify({
        state,
        attributes: attributes ?? {},
      }),
    });
  }

  /**
   * Delete an entity's state
   */
  async deleteState(entityId: string): Promise<{ message: string }> {
    return this.request(`/api/states/${entityId}`, {
      method: 'DELETE',
    });
  }

  // ==================== Service Calls ====================

  /**
   * Call a service
   * @param domain - Service domain (e.g., 'light', 'climate', 'switch')
   * @param service - Service name (e.g., 'turn_on', 'turn_off', 'toggle')
   * @param data - Optional service data (e.g., entity_id, brightness, color)
   * @param returnResponse - If true, return the response data from the service call
   */
  async callService(
    domain: string,
    service: string,
    data?: ServiceCallData,
    returnResponse?: boolean
  ): Promise<EntityState[]> {
    const url = `/api/services/${domain}/${service}`;
    const queryParams = returnResponse ? '?return_response=true' : '';

    return this.request(`${url}${queryParams}`, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  // ==================== Convenience Methods for Common Services ====================

  // --- Lights ---

  /**
   * Turn on one or more lights
   */
  async turnOnLight(
    entityId: string | string[],
    options?: {
      brightness?: number;
      rgb_color?: [number, number, number];
      color_temp?: number;
      transition?: number;
    }
  ): Promise<EntityState[]> {
    return this.callService('light', 'turn_on', {
      entity_id: entityId,
      ...options,
    });
  }

  /**
   * Turn off one or more lights
   */
  async turnOffLight(
    entityId: string | string[],
    options?: { transition?: number }
  ): Promise<EntityState[]> {
    return this.callService('light', 'turn_off', {
      entity_id: entityId,
      ...options,
    });
  }

  /**
   * Toggle one or more lights
   */
  async toggleLight(entityId: string | string[]): Promise<EntityState[]> {
    return this.callService('light', 'toggle', { entity_id: entityId });
  }

  // --- Switches ---

  /**
   * Turn on a switch
   */
  async turnOnSwitch(entityId: string | string[]): Promise<EntityState[]> {
    return this.callService('switch', 'turn_on', { entity_id: entityId });
  }

  /**
   * Turn off a switch
   */
  async turnOffSwitch(entityId: string | string[]): Promise<EntityState[]> {
    return this.callService('switch', 'turn_off', { entity_id: entityId });
  }

  /**
   * Toggle a switch
   */
  async toggleSwitch(entityId: string | string[]): Promise<EntityState[]> {
    return this.callService('switch', 'toggle', { entity_id: entityId });
  }

  // --- Climate ---

  /**
   * Set climate temperature
   */
  async setTemperature(
    entityId: string | string[],
    temperature: number,
    options?: {
      target_temp_low?: number;
      target_temp_high?: number;
      hvac_mode?: string;
    }
  ): Promise<EntityState[]> {
    return this.callService('climate', 'set_temperature', {
      entity_id: entityId,
      temperature,
      ...options,
    });
  }

  /**
   * Set climate HVAC mode
   */
  async setHvacMode(
    entityId: string | string[],
    hvacMode: 'off' | 'heat' | 'cool' | 'heat_cool' | 'auto' | 'dry' | 'fan_only'
  ): Promise<EntityState[]> {
    return this.callService('climate', 'set_hvac_mode', {
      entity_id: entityId,
      hvac_mode: hvacMode,
    });
  }

  // --- Media Players ---

  /**
   * Play media
   */
  async mediaPlay(entityId: string | string[]): Promise<EntityState[]> {
    return this.callService('media_player', 'media_play', { entity_id: entityId });
  }

  /**
   * Pause media
   */
  async mediaPause(entityId: string | string[]): Promise<EntityState[]> {
    return this.callService('media_player', 'media_pause', { entity_id: entityId });
  }

  /**
   * Set media volume
   */
  async setVolume(
    entityId: string | string[],
    volumeLevel: number
  ): Promise<EntityState[]> {
    return this.callService('media_player', 'volume_set', {
      entity_id: entityId,
      volume_level: volumeLevel,
    });
  }

  // --- Automations ---

  /**
   * Trigger an automation
   */
  async triggerAutomation(entityId: string | string[]): Promise<EntityState[]> {
    return this.callService('automation', 'trigger', { entity_id: entityId });
  }

  /**
   * Turn on an automation
   */
  async turnOnAutomation(entityId: string | string[]): Promise<EntityState[]> {
    return this.callService('automation', 'turn_on', { entity_id: entityId });
  }

  /**
   * Turn off an automation
   */
  async turnOffAutomation(entityId: string | string[]): Promise<EntityState[]> {
    return this.callService('automation', 'turn_off', { entity_id: entityId });
  }

  // --- Scenes ---

  /**
   * Activate a scene
   */
  async activateScene(entityId: string): Promise<EntityState[]> {
    return this.callService('scene', 'turn_on', { entity_id: entityId });
  }

  // ==================== History & Logging ====================

  /**
   * Get history for entities
   * @param timestamp - ISO timestamp or 'now'
   * @param filterEntityId - Optional entity ID to filter
   * @param endTime - Optional end time
   */
  async getHistory(
    timestamp: string,
    filterEntityId?: string,
    endTime?: string
  ): Promise<HistoryState[][]> {
    let path = `/api/history/period/${timestamp}`;
    const params = new URLSearchParams();

    if (filterEntityId) params.append('filter_entity_id', filterEntityId);
    if (endTime) params.append('end_time', endTime);

    const queryString = params.toString();
    if (queryString) path += `?${queryString}`;

    return this.request(path);
  }

  /**
   * Get logbook entries
   * @param timestamp - ISO timestamp or 'now'
   * @param entity - Optional entity ID to filter
   */
  async getLogbook(
    timestamp: string,
    entity?: string
  ): Promise<LogbookEntry[]> {
    let path = `/api/logbook/${timestamp}`;
    if (entity) path += `?entity=${entity}`;

    return this.request(path);
  }

  /**
   * Get error log
   */
  async getErrorLog(): Promise<string> {
    return this.request('/api/error_log');
  }

  // ==================== Additional Features ====================

  /**
   * Get list of calendars
   */
  async getCalendars(): Promise<Array<{ entity_id: string; name: string }>> {
    return this.request('/api/calendars');
  }

  /**
   * Get calendar events
   */
  async getCalendarEvents(
    entityId: string,
    start?: string,
    end?: string
  ): Promise<CalendarEvent[]> {
    let path = `/api/calendars/${entityId}`;
    const params = new URLSearchParams();

    if (start) params.append('start', start);
    if (end) params.append('end', end);

    const queryString = params.toString();
    if (queryString) path += `?${queryString}`;

    return this.request(path);
  }

  /**
   * Render a template
   */
  async renderTemplate(template: string): Promise<string> {
    const result = await this.request<TemplateResult>('/api/template', {
      method: 'POST',
      body: JSON.stringify({ template }),
    });
    return result.result;
  }

  // ==================== Helper Methods ====================

  /**
   * Get all entities of a specific domain
   */
  async getEntitiesByDomain(domain: string): Promise<EntityState[]> {
    const allStates = await this.getStates();
    return allStates.filter(state => state.entity_id.startsWith(`${domain}.`));
  }

  /**
   * Get all lights
   */
  async getLights(): Promise<EntityState[]> {
    return this.getEntitiesByDomain('light');
  }

  /**
   * Get all switches
   */
  async getSwitches(): Promise<EntityState[]> {
    return this.getEntitiesByDomain('switch');
  }

  /**
   * Get all sensors
   */
  async getSensors(): Promise<EntityState[]> {
    return this.getEntitiesByDomain('sensor');
  }

  /**
   * Get all climate devices
   */
  async getClimateDevices(): Promise<EntityState[]> {
    return this.getEntitiesByDomain('climate');
  }

  /**
   * Get all media players
   */
  async getMediaPlayers(): Promise<EntityState[]> {
    return this.getEntitiesByDomain('media_player');
  }

  /**
   * Get all automations
   */
  async getAutomations(): Promise<EntityState[]> {
    return this.getEntitiesByDomain('automation');
  }

  /**
   * Get all scenes
   */
  async getScenes(): Promise<EntityState[]> {
    return this.getEntitiesByDomain('scene');
  }

  /**
   * Get all binary sensors
   */
  async getBinarySensors(): Promise<EntityState[]> {
    return this.getEntitiesByDomain('binary_sensor');
  }

  /**
   * Get all cameras
   */
  async getCameras(): Promise<EntityState[]> {
    return this.getEntitiesByDomain('camera');
  }

  /**
   * Check if an entity is on
   */
  async isOn(entityId: string): Promise<boolean> {
    const state = await this.getState(entityId);
    return state.state === 'on';
  }

  /**
   * Check if an entity is off
   */
  async isOff(entityId: string): Promise<boolean> {
    const state = await this.getState(entityId);
    return state.state === 'off';
  }
}
