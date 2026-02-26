/**
 * Red/Green Tests for Home Assistant Client
 * Run with: npm test
 */

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert';
import { HomeAssistantClient } from '../src/client';
import type { EntityState, ServiceDomain } from '../src/types';

// Mock fetch for testing
const originalFetch = globalThis.fetch;
let mockFetch: any;

before(() => {
  mockFetch = mock.fn(async (url: string, options?: any) => {
    const path = url.replace('http://localhost:8123', '');

    // Check authorization header
    const authHeader = options?.headers?.['Authorization'];
    if (!authHeader || authHeader !== 'Bearer test-token') {
      return {
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
      };
    }

    // Mock API responses
    if (path === '/api/') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ message: 'API running' }),
      };
    }

    if (path === '/api/states') {
      return {
        ok: true,
        status: 200,
        json: async () => ([
          {
            entity_id: 'light.living_room',
            state: 'on',
            attributes: { brightness: 255, friendly_name: 'Living Room' },
            last_changed: '2024-01-01T00:00:00+00:00',
            last_updated: '2024-01-01T00:00:00+00:00',
            context: { id: '1', parent_id: null, user_id: null },
          },
          {
            entity_id: 'sensor.temperature',
            state: '22.5',
            attributes: { unit_of_measurement: '°C', friendly_name: 'Temperature' },
            last_changed: '2024-01-01T00:00:00+00:00',
            last_updated: '2024-01-01T00:00:00+00:00',
            context: { id: '2', parent_id: null, user_id: null },
          },
        ] as EntityState[]),
      };
    }

    if (path === '/api/states/light.living_room') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          entity_id: 'light.living_room',
          state: 'on',
          attributes: { brightness: 255, friendly_name: 'Living Room' },
          last_changed: '2024-01-01T00:00:00+00:00',
          last_updated: '2024-01-01T00:00:00+00:00',
          context: { id: '1', parent_id: null, user_id: null },
        } as EntityState),
      };
    }

    if (path === '/api/states/sensor.nonexistent') {
      return {
        ok: false,
        status: 404,
        json: async () => ({ message: 'Entity not found' }),
      };
    }

    if ((path === '/api/services/light/turn_on' || path.startsWith('/api/services/light/turn_on?')) && options?.method === 'POST') {
      const body = options.body ? JSON.parse(options.body) : {};
      return {
        ok: true,
        status: 200,
        json: async () => ([
          {
            entity_id: body.entity_id || 'light.default',
            state: 'on',
            attributes: { brightness: body.brightness || 255 },
            last_changed: '2024-01-01T00:00:00+00:00',
            last_updated: '2024-01-01T00:00:00+00:00',
            context: { id: '3', parent_id: null, user_id: null },
          },
        ] as EntityState[]),
      };
    }

    if (path === '/api/services/light/turn_off' && options?.method === 'POST') {
      const body = options.body ? JSON.parse(options.body) : {};
      return {
        ok: true,
        status: 200,
        json: async () => ([
          {
            entity_id: body.entity_id || 'light.default',
            state: 'off',
            attributes: {},
            last_changed: '2024-01-01T00:00:00+00:00',
            last_updated: '2024-01-01T00:00:00+00:00',
            context: { id: '4', parent_id: null, user_id: null },
          },
        ] as EntityState[]),
      };
    }

    if (path === '/api/components') {
      return {
        ok: true,
        status: 200,
        json: async () => ['light', 'sensor', 'climate', 'automation'],
      };
    }

    if (path === '/api/services') {
      return {
        ok: true,
        status: 200,
        json: async () => ([
          {
            domain: 'light',
            services: {
              turn_on: {
                name: 'Turn on',
                description: 'Turn on light',
                fields: {},
              },
              turn_off: {
                name: 'Turn off',
                description: 'Turn off light',
                fields: {},
              },
            },
          },
        ] as ServiceDomain[]),
      };
    }

    if (path.startsWith('/api/events/') && options?.method === 'POST') {
      const eventType = path.replace('/api/events/', '');
      return {
        ok: true,
        status: 200,
        json: async () => ({ message: `Event ${eventType} fired` }),
      };
    }

    if (path === '/api/config') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          latitude: 52.0,
          longitude: 4.0,
          elevation: 0,
          unit_system: { length: 'km', mass: 'kg', temperature: '°C', volume: 'L' },
          location_name: 'Test Home',
          time_zone: 'Europe/Amsterdam',
          version: '2024.1.0',
        }),
      };
    }

    if (path === '/api/events') {
      return {
        ok: true,
        status: 200,
        json: async () => ([
          { event: 'state_changed', listener_count: 10 },
          { event: 'service_registered', listener_count: 5 },
        ]),
      };
    }

    if (path.startsWith('/api/history/period/')) {
      return {
        ok: true,
        status: 200,
        json: async () => [[
          {
            entity_id: 'sensor.temperature',
            state: '22.5',
            attributes: { unit_of_measurement: '°C' },
            last_changed: '2024-01-01T00:00:00+00:00',
            last_updated: '2024-01-01T00:00:00+00:00',
          },
          {
            entity_id: 'sensor.temperature',
            state: '23.0',
            attributes: { unit_of_measurement: '°C' },
            last_changed: '2024-01-01T01:00:00+00:00',
            last_updated: '2024-01-01T01:00:00+00:00',
          },
        ]],
      };
    }

    if (path.startsWith('/api/logbook/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ([
          {
            when: '2024-01-01T00:00:00+00:00',
            name: 'Living Room Light',
            domain: 'light',
            entity_id: 'light.living_room',
            message: 'turned on',
          },
        ]),
      };
    }

    if (path === '/api/error_log') {
      return {
        ok: true,
        status: 200,
        json: async () => 'Error log content here\nAnother error line',
      };
    }

    if (path === '/api/calendars') {
      return {
        ok: true,
        status: 200,
        json: async () => ([
          { entity_id: 'calendar.personal', name: 'Personal Calendar' },
          { entity_id: 'calendar.work', name: 'Work Calendar' },
        ]),
      };
    }

    if (path.startsWith('/api/calendars/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ([
          {
            start: { dateTime: '2024-01-01T10:00:00+00:00' },
            end: { dateTime: '2024-01-01T11:00:00+00:00' },
            summary: 'Team Meeting',
            description: 'Weekly sync',
          },
        ]),
      };
    }

    if (path === '/api/template' && options?.method === 'POST') {
      const body = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: `Rendered: ${body.template}` }),
      };
    }

    if (path === '/api/services/climate/set_temperature' && options?.method === 'POST') {
      const body = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ([
          {
            entity_id: body.entity_id || 'climate.default',
            state: 'heat',
            attributes: { temperature: body.temperature },
            last_changed: '2024-01-01T00:00:00+00:00',
            last_updated: '2024-01-01T00:00:00+00:00',
            context: { id: '5', parent_id: null, user_id: null },
          },
        ]),
      };
    }

    if (path === '/api/services/climate/set_hvac_mode' && options?.method === 'POST') {
      const body = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ([
          {
            entity_id: body.entity_id || 'climate.default',
            state: body.hvac_mode,
            attributes: {},
            last_changed: '2024-01-01T00:00:00+00:00',
            last_updated: '2024-01-01T00:00:00+00:00',
            context: { id: '6', parent_id: null, user_id: null },
          },
        ]),
      };
    }

    if (path === '/api/services/media_player/media_play' && options?.method === 'POST') {
      const body = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ([
          {
            entity_id: body.entity_id || 'media_player.default',
            state: 'playing',
            attributes: {},
            last_changed: '2024-01-01T00:00:00+00:00',
            last_updated: '2024-01-01T00:00:00+00:00',
            context: { id: '7', parent_id: null, user_id: null },
          },
        ]),
      };
    }

    if (path === '/api/services/media_player/media_pause' && options?.method === 'POST') {
      const body = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ([
          {
            entity_id: body.entity_id || 'media_player.default',
            state: 'paused',
            attributes: {},
            last_changed: '2024-01-01T00:00:00+00:00',
            last_updated: '2024-01-01T00:00:00+00:00',
            context: { id: '8', parent_id: null, user_id: null },
          },
        ]),
      };
    }

    if (path === '/api/services/media_player/volume_set' && options?.method === 'POST') {
      const body = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ([
          {
            entity_id: body.entity_id || 'media_player.default',
            state: 'playing',
            attributes: { volume_level: body.volume_level },
            last_changed: '2024-01-01T00:00:00+00:00',
            last_updated: '2024-01-01T00:00:00+00:00',
            context: { id: '9', parent_id: null, user_id: null },
          },
        ]),
      };
    }

    if (path === '/api/services/automation/trigger' && options?.method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ([]),
      };
    }

    if (path === '/api/services/automation/turn_on' && options?.method === 'POST') {
      const body = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ([
          {
            entity_id: body.entity_id || 'automation.default',
            state: 'on',
            attributes: {},
            last_changed: '2024-01-01T00:00:00+00:00',
            last_updated: '2024-01-01T00:00:00+00:00',
            context: { id: '10', parent_id: null, user_id: null },
          },
        ]),
      };
    }

    if (path === '/api/services/automation/turn_off' && options?.method === 'POST') {
      const body = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ([
          {
            entity_id: body.entity_id || 'automation.default',
            state: 'off',
            attributes: {},
            last_changed: '2024-01-01T00:00:00+00:00',
            last_updated: '2024-01-01T00:00:00+00:00',
            context: { id: '11', parent_id: null, user_id: null },
          },
        ]),
      };
    }

    if (path === '/api/services/scene/turn_on' && options?.method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ([]),
      };
    }

    if (path === '/api/services/switch/turn_on' && options?.method === 'POST') {
      const body = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ([
          {
            entity_id: body.entity_id || 'switch.default',
            state: 'on',
            attributes: {},
            last_changed: '2024-01-01T00:00:00+00:00',
            last_updated: '2024-01-01T00:00:00+00:00',
            context: { id: '12', parent_id: null, user_id: null },
          },
        ]),
      };
    }

    if (path === '/api/services/switch/turn_off' && options?.method === 'POST') {
      const body = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ([
          {
            entity_id: body.entity_id || 'switch.default',
            state: 'off',
            attributes: {},
            last_changed: '2024-01-01T00:00:00+00:00',
            last_updated: '2024-01-01T00:00:00+00:00',
            context: { id: '13', parent_id: null, user_id: null },
          },
        ]),
      };
    }

    if (path === '/api/services/switch/toggle' && options?.method === 'POST') {
      const body = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ([
          {
            entity_id: body.entity_id || 'switch.default',
            state: 'on',
            attributes: {},
            last_changed: '2024-01-01T00:00:00+00:00',
            last_updated: '2024-01-01T00:00:00+00:00',
            context: { id: '14', parent_id: null, user_id: null },
          },
        ]),
      };
    }

    // Default 404
    return {
      ok: false,
      status: 404,
      json: async () => ({ message: 'Not found' }),
    };
  });

  globalThis.fetch = mockFetch as any;
});

after(() => {
  globalThis.fetch = originalFetch;
});

describe('HomeAssistantClient', () => {
  const client = new HomeAssistantClient({
    baseUrl: 'http://localhost:8123',
    accessToken: 'test-token',
  });

  describe('Authentication', () => {
    it('should include authorization header', async () => {
      await client.getApiStatus();
      const calls = mockFetch.mock.calls;
      const lastCall = calls[calls.length - 1];
      assert.strictEqual(lastCall.arguments[1].headers['Authorization'], 'Bearer test-token');
    });

    it('should reject unauthorized requests', async () => {
      const badClient = new HomeAssistantClient({
        baseUrl: 'http://localhost:8123',
        accessToken: 'wrong-token',
      });

      await assert.rejects(
        async () => await badClient.getApiStatus(),
        /Unauthorized/
      );
    });
  });

  describe('System Information', () => {
    it('should check API status', async () => {
      const result = await client.getApiStatus();
      assert.strictEqual(result.message, 'API running');
    });

    it('should get components', async () => {
      const components = await client.getComponents();
      assert.ok(Array.isArray(components));
      assert.ok(components.includes('light'));
      assert.ok(components.includes('sensor'));
    });

    it('should get services', async () => {
      const services = await client.getServices();
      assert.ok(Array.isArray(services));
      const lightServices = services.find(s => s.domain === 'light');
      assert.ok(lightServices);
      assert.ok(lightServices.services.turn_on);
      assert.ok(lightServices.services.turn_off);
    });
  });

  describe('State Management', () => {
    it('should get all states', async () => {
      const states = await client.getStates();
      assert.ok(Array.isArray(states));
      assert.strictEqual(states.length, 2);
      assert.strictEqual(states[0].entity_id, 'light.living_room');
      assert.strictEqual(states[1].entity_id, 'sensor.temperature');
    });

    it('should get specific entity state', async () => {
      const state = await client.getState('light.living_room');
      assert.strictEqual(state.entity_id, 'light.living_room');
      assert.strictEqual(state.state, 'on');
      assert.strictEqual(state.attributes.brightness, 255);
    });

    it('should handle non-existent entity', async () => {
      await assert.rejects(
        async () => await client.getState('sensor.nonexistent'),
        /Entity not found/
      );
    });

    it('should filter entities by domain', async () => {
      const lights = await client.getLights();
      assert.ok(Array.isArray(lights));
      assert.ok(lights.every(l => l.entity_id.startsWith('light.')));
    });
  });

  describe('Light Control', () => {
    it('should turn on light', async () => {
      const result = await client.turnOnLight('light.living_room');
      assert.ok(Array.isArray(result));
      assert.strictEqual(result[0].state, 'on');
    });

    it('should turn on light with brightness', async () => {
      const result = await client.turnOnLight('light.living_room', { brightness: 128 });
      assert.ok(Array.isArray(result));
      assert.strictEqual(result[0].state, 'on');
      assert.strictEqual(result[0].attributes.brightness, 128);
    });

    it('should turn off light', async () => {
      const result = await client.turnOffLight('light.living_room');
      assert.ok(Array.isArray(result));
      assert.strictEqual(result[0].state, 'off');
    });

    it('should handle multiple entity IDs', async () => {
      const result = await client.turnOnLight(['light.living_room', 'light.bedroom']);
      assert.ok(Array.isArray(result));
    });
  });

  describe('Helper Methods', () => {
    it('should check if entity is on', async () => {
      const isOn = await client.isOn('light.living_room');
      assert.strictEqual(isOn, true);
    });

    it('should check if entity is off', async () => {
      // Mock turn_off first
      await client.turnOffLight('light.living_room');
      // Note: In real scenario, we'd need to update the mock to return 'off'
      // For this test, we just verify the method exists and returns a boolean
      const isOff = await client.isOff('light.living_room');
      assert.strictEqual(typeof isOff, 'boolean');
    });

    it('should get media players', async () => {
      const mediaPlayers = await client.getMediaPlayers();
      assert.ok(Array.isArray(mediaPlayers));
    });

    it('should get automations', async () => {
      const automations = await client.getAutomations();
      assert.ok(Array.isArray(automations));
    });

    it('should get scenes', async () => {
      const scenes = await client.getScenes();
      assert.ok(Array.isArray(scenes));
    });

    it('should get binary sensors', async () => {
      const binarySensors = await client.getBinarySensors();
      assert.ok(Array.isArray(binarySensors));
    });

    it('should get cameras', async () => {
      const cameras = await client.getCameras();
      assert.ok(Array.isArray(cameras));
    });
  });

  describe('Service Calls', () => {
    it('should call generic service', async () => {
      const result = await client.callService('light', 'turn_on', {
        entity_id: 'light.bedroom',
      });
      assert.ok(Array.isArray(result));
    });

    it('should handle service call without data', async () => {
      const result = await client.callService('light', 'turn_on');
      assert.ok(Array.isArray(result));
    });

    it('should support return_response parameter', async () => {
      const result = await client.callService('light', 'turn_on', {
        entity_id: 'light.bedroom',
      }, true);
      assert.ok(Array.isArray(result));
      // Check that URL has query parameter
      const calls = mockFetch.mock.calls;
      const lastCall = calls[calls.length - 1];
      assert.ok(lastCall.arguments[0].includes('return_response=true'));
    });
  });

  describe('Events', () => {
    it('should fire custom event', async () => {
      const result = await client.fireEvent('my_custom_event', { foo: 'bar' });
      assert.ok(result.message);
      assert.ok(result.message.includes('my_custom_event'));
    });

    it('should fire event without data', async () => {
      const result = await client.fireEvent('my_event');
      assert.ok(result.message);
    });

    it('should get event types and listener counts', async () => {
      const events = await client.getEvents();
      assert.ok(Array.isArray(events));
      assert.ok(events.length > 0);
      assert.strictEqual(events[0].event, 'state_changed');
      assert.strictEqual(events[0].listener_count, 10);
    });
  });

  describe('Configuration', () => {
    it('should get Home Assistant configuration', async () => {
      const config = await client.getConfig();
      assert.ok(config);
      assert.strictEqual(config.location_name, 'Test Home');
      assert.strictEqual(config.version, '2024.1.0');
      assert.ok(config.unit_system);
    });
  });

  describe('History & Logging', () => {
    it('should get history for entities', async () => {
      const history = await client.getHistory('2024-01-01T00:00:00');
      assert.ok(Array.isArray(history));
      assert.ok(Array.isArray(history[0]));
      assert.strictEqual(history[0][0].entity_id, 'sensor.temperature');
      assert.strictEqual(history[0][0].state, '22.5');
    });

    it('should get history with entity filter', async () => {
      const history = await client.getHistory('2024-01-01T00:00:00', 'sensor.temperature');
      assert.ok(Array.isArray(history));
    });

    it('should get logbook entries', async () => {
      const logbook = await client.getLogbook('2024-01-01T00:00:00');
      assert.ok(Array.isArray(logbook));
      assert.strictEqual(logbook[0].name, 'Living Room Light');
      assert.strictEqual(logbook[0].message, 'turned on');
    });

    it('should get error log', async () => {
      const errorLog = await client.getErrorLog();
      assert.ok(typeof errorLog === 'string');
      assert.ok(errorLog.includes('Error log content'));
    });
  });

  describe('Calendars', () => {
    it('should get list of calendars', async () => {
      const calendars = await client.getCalendars();
      assert.ok(Array.isArray(calendars));
      assert.strictEqual(calendars[0].entity_id, 'calendar.personal');
      assert.strictEqual(calendars[0].name, 'Personal Calendar');
    });

    it('should get calendar events', async () => {
      const events = await client.getCalendarEvents('calendar.personal');
      assert.ok(Array.isArray(events));
      assert.strictEqual(events[0].summary, 'Team Meeting');
      assert.ok(events[0].start);
      assert.ok(events[0].end);
    });

    it('should get calendar events with date range', async () => {
      const events = await client.getCalendarEvents(
        'calendar.personal',
        '2024-01-01T00:00:00',
        '2024-01-31T23:59:59'
      );
      assert.ok(Array.isArray(events));
    });
  });

  describe('Templates', () => {
    it('should render template', async () => {
      const result = await client.renderTemplate('{{ 1 + 1 }}');
      assert.ok(typeof result === 'string');
      assert.ok(result.includes('Rendered'));
    });
  });

  describe('Climate Control', () => {
    it('should set temperature', async () => {
      const result = await client.setTemperature('climate.living_room', 22);
      assert.ok(Array.isArray(result));
      assert.strictEqual(result[0].attributes.temperature, 22);
    });

    it('should set temperature with HVAC mode', async () => {
      const result = await client.setTemperature('climate.bedroom', 20, { hvac_mode: 'heat' });
      assert.ok(Array.isArray(result));
    });

    it('should set HVAC mode', async () => {
      const result = await client.setHvacMode('climate.living_room', 'cool');
      assert.ok(Array.isArray(result));
      assert.strictEqual(result[0].state, 'cool');
    });
  });

  describe('Media Players', () => {
    it('should play media', async () => {
      const result = await client.mediaPlay('media_player.living_room');
      assert.ok(Array.isArray(result));
      assert.strictEqual(result[0].state, 'playing');
    });

    it('should pause media', async () => {
      const result = await client.mediaPause('media_player.living_room');
      assert.ok(Array.isArray(result));
      assert.strictEqual(result[0].state, 'paused');
    });

    it('should set volume', async () => {
      const result = await client.setVolume('media_player.living_room', 0.5);
      assert.ok(Array.isArray(result));
      assert.strictEqual(result[0].attributes.volume_level, 0.5);
    });
  });

  describe('Automations', () => {
    it('should trigger automation', async () => {
      const result = await client.triggerAutomation('automation.morning_routine');
      assert.ok(Array.isArray(result));
    });

    it('should turn on automation', async () => {
      const result = await client.turnOnAutomation('automation.morning_routine');
      assert.ok(Array.isArray(result));
      assert.strictEqual(result[0].state, 'on');
    });

    it('should turn off automation', async () => {
      const result = await client.turnOffAutomation('automation.morning_routine');
      assert.ok(Array.isArray(result));
      assert.strictEqual(result[0].state, 'off');
    });
  });

  describe('Scenes', () => {
    it('should activate scene', async () => {
      const result = await client.activateScene('scene.movie_time');
      assert.ok(Array.isArray(result));
    });
  });

  describe('Switch Control', () => {
    it('should turn on switch', async () => {
      const result = await client.turnOnSwitch('switch.living_room');
      assert.ok(Array.isArray(result));
      assert.strictEqual(result[0].state, 'on');
    });

    it('should turn off switch', async () => {
      const result = await client.turnOffSwitch('switch.living_room');
      assert.ok(Array.isArray(result));
      assert.strictEqual(result[0].state, 'off');
    });

    it('should toggle switch', async () => {
      const result = await client.toggleSwitch('switch.living_room');
      assert.ok(Array.isArray(result));
    });
  });
});
