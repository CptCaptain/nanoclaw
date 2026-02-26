#!/usr/bin/env node
/**
 * MCP Server for Home Assistant
 * Provides tools for controlling Home Assistant via MCP protocol
 */

import { HomeAssistantClient } from './client.js';
import type { EntityState } from './types.js';

const CONFIG_FILE = process.env.HA_CONFIG || `${process.env.HOME}/.config/home-assistant/config.json`;

interface Config {
  baseUrl: string;
  accessToken: string;
}

let client: HomeAssistantClient | null = null;

function loadConfig(): Config {
  try {
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    return config;
  } catch (error) {
    throw new Error(`Failed to load config from ${CONFIG_FILE}: ${error}`);
  }
}

function getClient(): HomeAssistantClient {
  if (!client) {
    const config = loadConfig();
    client = new HomeAssistantClient(config);
  }
  return client;
}

// MCP Server implementation
const server = {
  name: 'home-assistant',
  version: '1.0.0',

  tools: [
    {
      name: 'ha_get_states',
      description: 'Get states of all entities or filter by domain',
      inputSchema: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            description: 'Optional domain to filter (e.g., "light", "sensor", "climate")',
          },
        },
      },
    },
    {
      name: 'ha_get_state',
      description: 'Get state of a specific entity',
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: {
            type: 'string',
            description: 'Entity ID (e.g., "light.living_room")',
          },
        },
        required: ['entity_id'],
      },
    },
    {
      name: 'ha_turn_on_light',
      description: 'Turn on one or more lights with optional brightness and color',
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
            description: 'Light entity ID(s)',
          },
          brightness: {
            type: 'number',
            minimum: 0,
            maximum: 255,
            description: 'Brightness level (0-255)',
          },
          rgb_color: {
            type: 'array',
            items: { type: 'number', minimum: 0, maximum: 255 },
            minItems: 3,
            maxItems: 3,
            description: 'RGB color [r, g, b] (0-255 each)',
          },
          color_temp: {
            type: 'number',
            description: 'Color temperature in mireds',
          },
          transition: {
            type: 'number',
            description: 'Transition time in seconds',
          },
        },
        required: ['entity_id'],
      },
    },
    {
      name: 'ha_turn_off_light',
      description: 'Turn off one or more lights',
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
            description: 'Light entity ID(s)',
          },
          transition: {
            type: 'number',
            description: 'Transition time in seconds',
          },
        },
        required: ['entity_id'],
      },
    },
    {
      name: 'ha_toggle_light',
      description: 'Toggle one or more lights',
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
            description: 'Light entity ID(s)',
          },
        },
        required: ['entity_id'],
      },
    },
    {
      name: 'ha_turn_on_switch',
      description: 'Turn on one or more switches',
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
            description: 'Switch entity ID(s)',
          },
        },
        required: ['entity_id'],
      },
    },
    {
      name: 'ha_turn_off_switch',
      description: 'Turn off one or more switches',
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
            description: 'Switch entity ID(s)',
          },
        },
        required: ['entity_id'],
      },
    },
    {
      name: 'ha_set_temperature',
      description: 'Set temperature for climate devices',
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
            description: 'Climate entity ID(s)',
          },
          temperature: {
            type: 'number',
            description: 'Target temperature',
          },
          hvac_mode: {
            type: 'string',
            enum: ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'],
            description: 'Optional HVAC mode',
          },
        },
        required: ['entity_id', 'temperature'],
      },
    },
    {
      name: 'ha_set_hvac_mode',
      description: 'Set HVAC mode for climate devices',
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
            description: 'Climate entity ID(s)',
          },
          hvac_mode: {
            type: 'string',
            enum: ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'],
            description: 'HVAC mode',
          },
        },
        required: ['entity_id', 'hvac_mode'],
      },
    },
    {
      name: 'ha_trigger_automation',
      description: 'Trigger an automation',
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
            description: 'Automation entity ID(s)',
          },
        },
        required: ['entity_id'],
      },
    },
    {
      name: 'ha_activate_scene',
      description: 'Activate a scene',
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: {
            type: 'string',
            description: 'Scene entity ID',
          },
        },
        required: ['entity_id'],
      },
    },
    {
      name: 'ha_call_service',
      description: 'Call any Home Assistant service',
      inputSchema: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            description: 'Service domain (e.g., "light", "switch")',
          },
          service: {
            type: 'string',
            description: 'Service name (e.g., "turn_on", "turn_off")',
          },
          data: {
            type: 'object',
            description: 'Service data (e.g., {"entity_id": "light.living_room"})',
          },
          return_response: {
            type: 'boolean',
            description: 'If true, return the response data from the service call',
          },
        },
        required: ['domain', 'service'],
      },
    },
    {
      name: 'ha_fire_event',
      description: 'Fire a custom event on the Home Assistant event bus',
      inputSchema: {
        type: 'object',
        properties: {
          event_type: {
            type: 'string',
            description: 'The event type to fire (e.g., "my_custom_event")',
          },
          event_data: {
            type: 'object',
            description: 'Optional event data payload',
          },
        },
        required: ['event_type'],
      },
    },
    {
      name: 'ha_get_config',
      description: 'Get Home Assistant configuration (location, version, units, etc.)',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'ha_get_events',
      description: 'Get list of event types and their listener counts',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'ha_get_history',
      description: 'Get historical states for entities over a time period',
      inputSchema: {
        type: 'object',
        properties: {
          timestamp: {
            type: 'string',
            description: 'Start time as ISO timestamp (e.g., "2024-01-01T00:00:00")',
          },
          filter_entity_id: {
            type: 'string',
            description: 'Optional entity ID to filter results',
          },
          end_time: {
            type: 'string',
            description: 'Optional end time as ISO timestamp',
          },
        },
        required: ['timestamp'],
      },
    },
    {
      name: 'ha_get_logbook',
      description: 'Get logbook entries showing entity state changes and events',
      inputSchema: {
        type: 'object',
        properties: {
          timestamp: {
            type: 'string',
            description: 'Start time as ISO timestamp (e.g., "2024-01-01T00:00:00")',
          },
          entity: {
            type: 'string',
            description: 'Optional entity ID to filter results',
          },
        },
        required: ['timestamp'],
      },
    },
    {
      name: 'ha_get_error_log',
      description: 'Get the Home Assistant error log content',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'ha_get_calendars',
      description: 'Get list of calendar entities',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'ha_get_calendar_events',
      description: 'Get events from a calendar',
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: {
            type: 'string',
            description: 'Calendar entity ID (e.g., "calendar.personal")',
          },
          start: {
            type: 'string',
            description: 'Optional start time as ISO timestamp',
          },
          end: {
            type: 'string',
            description: 'Optional end time as ISO timestamp',
          },
        },
        required: ['entity_id'],
      },
    },
    {
      name: 'ha_render_template',
      description: 'Render a Home Assistant template (Jinja2)',
      inputSchema: {
        type: 'object',
        properties: {
          template: {
            type: 'string',
            description: 'Template string to render (e.g., "{{ states.light.living_room.state }}")',
          },
        },
        required: ['template'],
      },
    },
    {
      name: 'ha_media_play',
      description: 'Play media on a media player',
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
            description: 'Media player entity ID(s)',
          },
        },
        required: ['entity_id'],
      },
    },
    {
      name: 'ha_media_pause',
      description: 'Pause media on a media player',
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
            description: 'Media player entity ID(s)',
          },
        },
        required: ['entity_id'],
      },
    },
    {
      name: 'ha_set_volume',
      description: 'Set volume level for a media player',
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
            description: 'Media player entity ID(s)',
          },
          volume_level: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Volume level (0.0 to 1.0)',
          },
        },
        required: ['entity_id', 'volume_level'],
      },
    },
    {
      name: 'ha_turn_on_automation',
      description: 'Enable an automation',
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
            description: 'Automation entity ID(s)',
          },
        },
        required: ['entity_id'],
      },
    },
    {
      name: 'ha_turn_off_automation',
      description: 'Disable an automation',
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
            description: 'Automation entity ID(s)',
          },
        },
        required: ['entity_id'],
      },
    },
    {
      name: 'ha_toggle_switch',
      description: 'Toggle one or more switches',
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
            description: 'Switch entity ID(s)',
          },
        },
        required: ['entity_id'],
      },
    },
    {
      name: 'ha_get_media_players',
      description: 'Get all media player entities',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'ha_get_automations',
      description: 'Get all automation entities',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'ha_get_scenes',
      description: 'Get all scene entities',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'ha_get_binary_sensors',
      description: 'Get all binary sensor entities',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'ha_get_cameras',
      description: 'Get all camera entities',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ],

  async handleToolCall(name: string, params: any): Promise<any> {
    const ha = getClient();

    switch (name) {
      case 'ha_get_states':
        if (params.domain) {
          return await ha.getEntitiesByDomain(params.domain);
        }
        return await ha.getStates();

      case 'ha_get_state':
        return await ha.getState(params.entity_id);

      case 'ha_turn_on_light':
        return await ha.turnOnLight(params.entity_id, {
          brightness: params.brightness,
          rgb_color: params.rgb_color,
          color_temp: params.color_temp,
          transition: params.transition,
        });

      case 'ha_turn_off_light':
        return await ha.turnOffLight(params.entity_id, {
          transition: params.transition,
        });

      case 'ha_toggle_light':
        return await ha.toggleLight(params.entity_id);

      case 'ha_turn_on_switch':
        return await ha.turnOnSwitch(params.entity_id);

      case 'ha_turn_off_switch':
        return await ha.turnOffSwitch(params.entity_id);

      case 'ha_set_temperature':
        return await ha.setTemperature(params.entity_id, params.temperature, {
          hvac_mode: params.hvac_mode,
        });

      case 'ha_set_hvac_mode':
        return await ha.setHvacMode(params.entity_id, params.hvac_mode);

      case 'ha_trigger_automation':
        return await ha.triggerAutomation(params.entity_id);

      case 'ha_activate_scene':
        return await ha.activateScene(params.entity_id);

      case 'ha_call_service':
        return await ha.callService(params.domain, params.service, params.data, params.return_response);

      case 'ha_fire_event':
        return await ha.fireEvent(params.event_type, params.event_data);

      case 'ha_get_config':
        return await ha.getConfig();

      case 'ha_get_events':
        return await ha.getEvents();

      case 'ha_get_history':
        return await ha.getHistory(params.timestamp, params.filter_entity_id, params.end_time);

      case 'ha_get_logbook':
        return await ha.getLogbook(params.timestamp, params.entity);

      case 'ha_get_error_log':
        return await ha.getErrorLog();

      case 'ha_get_calendars':
        return await ha.getCalendars();

      case 'ha_get_calendar_events':
        return await ha.getCalendarEvents(params.entity_id, params.start, params.end);

      case 'ha_render_template':
        return await ha.renderTemplate(params.template);

      case 'ha_media_play':
        return await ha.mediaPlay(params.entity_id);

      case 'ha_media_pause':
        return await ha.mediaPause(params.entity_id);

      case 'ha_set_volume':
        return await ha.setVolume(params.entity_id, params.volume_level);

      case 'ha_turn_on_automation':
        return await ha.turnOnAutomation(params.entity_id);

      case 'ha_turn_off_automation':
        return await ha.turnOffAutomation(params.entity_id);

      case 'ha_toggle_switch':
        return await ha.toggleSwitch(params.entity_id);

      case 'ha_get_media_players':
        return await ha.getMediaPlayers();

      case 'ha_get_automations':
        return await ha.getAutomations();

      case 'ha_get_scenes':
        return await ha.getScenes();

      case 'ha_get_binary_sensors':
        return await ha.getBinarySensors();

      case 'ha_get_cameras':
        return await ha.getCameras();

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  },
};

// Handle stdio messages
process.stdin.on('data', async (data) => {
  try {
    const request = JSON.parse(data.toString());

    if (request.method === 'initialize') {
      console.log(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: server.name,
            version: server.version,
          },
        },
      }));
    } else if (request.method === 'tools/list') {
      console.log(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          tools: server.tools,
        },
      }));
    } else if (request.method === 'tools/call') {
      const result = await server.handleToolCall(
        request.params.name,
        request.params.arguments
      );
      console.log(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        },
      }));
    }
  } catch (error: any) {
    console.error(JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: error.message,
      },
    }));
  }
});
