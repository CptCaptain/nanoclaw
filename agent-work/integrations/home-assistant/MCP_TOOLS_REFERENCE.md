# Home Assistant MCP Tools Quick Reference

Complete list of all 32 MCP tools available in the Home Assistant integration.

## State & Information

### ha_get_states
Get states of all entities or filter by domain.
```typescript
ha_get_states({ domain: "light" })  // Get all lights
ha_get_states()                      // Get all entities
```

### ha_get_state
Get state of a specific entity.
```typescript
ha_get_state({ entity_id: "light.living_room" })
```

### ha_get_config
Get Home Assistant configuration (location, version, units, etc.).
```typescript
ha_get_config()
```

### ha_get_events
Get list of event types and their listener counts.
```typescript
ha_get_events()
```

## Lights

### ha_turn_on_light
Turn on lights with optional brightness and color.
```typescript
ha_turn_on_light({
  entity_id: "light.living_room",
  brightness: 200,
  rgb_color: [255, 0, 0],
  transition: 2
})
```

### ha_turn_off_light
Turn off lights.
```typescript
ha_turn_off_light({ entity_id: "light.bedroom", transition: 1 })
```

### ha_toggle_light
Toggle lights on/off.
```typescript
ha_toggle_light({ entity_id: "light.kitchen" })
```

## Switches

### ha_turn_on_switch
Turn on switches.
```typescript
ha_turn_on_switch({ entity_id: "switch.coffee_maker" })
```

### ha_turn_off_switch
Turn off switches.
```typescript
ha_turn_off_switch({ entity_id: "switch.fan" })
```

### ha_toggle_switch
Toggle switches on/off.
```typescript
ha_toggle_switch({ entity_id: "switch.lamp" })
```

## Climate

### ha_set_temperature
Set temperature for climate devices.
```typescript
ha_set_temperature({
  entity_id: "climate.bedroom",
  temperature: 22,
  hvac_mode: "heat"
})
```

### ha_set_hvac_mode
Set HVAC mode for climate devices.
```typescript
ha_set_hvac_mode({
  entity_id: "climate.living_room",
  hvac_mode: "cool"  // off, heat, cool, heat_cool, auto, dry, fan_only
})
```

## Media Players

### ha_media_play
Play media on a media player.
```typescript
ha_media_play({ entity_id: "media_player.living_room" })
```

### ha_media_pause
Pause media on a media player.
```typescript
ha_media_pause({ entity_id: "media_player.bedroom" })
```

### ha_set_volume
Set volume level for a media player.
```typescript
ha_set_volume({
  entity_id: "media_player.kitchen",
  volume_level: 0.5  // 0.0 to 1.0
})
```

## Automations

### ha_trigger_automation
Trigger an automation to run now.
```typescript
ha_trigger_automation({ entity_id: "automation.morning_routine" })
```

### ha_turn_on_automation
Enable an automation.
```typescript
ha_turn_on_automation({ entity_id: "automation.evening" })
```

### ha_turn_off_automation
Disable an automation.
```typescript
ha_turn_off_automation({ entity_id: "automation.vacation" })
```

## Scenes

### ha_activate_scene
Activate a scene.
```typescript
ha_activate_scene({ entity_id: "scene.movie_time" })
```

## History & Logging

### ha_get_history
Get historical states for entities over a time period.
```typescript
ha_get_history({
  timestamp: "2024-01-01T00:00:00",
  filter_entity_id: "sensor.temperature",
  end_time: "2024-01-01T23:59:59"
})
```

### ha_get_logbook
Get logbook entries showing entity state changes and events.
```typescript
ha_get_logbook({
  timestamp: "2024-01-01T00:00:00",
  entity: "light.living_room"
})
```

### ha_get_error_log
Get the Home Assistant error log content.
```typescript
ha_get_error_log()
```

## Calendars

### ha_get_calendars
Get list of calendar entities.
```typescript
ha_get_calendars()
```

### ha_get_calendar_events
Get events from a calendar.
```typescript
ha_get_calendar_events({
  entity_id: "calendar.personal",
  start: "2024-01-01T00:00:00",
  end: "2024-01-31T23:59:59"
})
```

## Templates

### ha_render_template
Render a Home Assistant template (Jinja2).
```typescript
ha_render_template({
  template: "{{ states.light.living_room.state }}"
})
```

## Helper Methods

### ha_get_media_players
Get all media player entities.
```typescript
ha_get_media_players()
```

### ha_get_automations
Get all automation entities.
```typescript
ha_get_automations()
```

### ha_get_scenes
Get all scene entities.
```typescript
ha_get_scenes()
```

### ha_get_binary_sensors
Get all binary sensor entities.
```typescript
ha_get_binary_sensors()
```

### ha_get_cameras
Get all camera entities.
```typescript
ha_get_cameras()
```

## Generic Service Call

### ha_call_service
Call any Home Assistant service.
```typescript
ha_call_service({
  domain: "notify",
  service: "mobile_app",
  data: { message: "Hello from NanoClaw!" },
  return_response: true
})
```

## Events

### ha_fire_event
Fire a custom event on the Home Assistant event bus.
```typescript
ha_fire_event({
  event_type: "my_custom_event",
  event_data: { foo: "bar", timestamp: "2024-01-01" }
})
```

---

## Usage Tips

1. **Entity IDs**: Most tools accept either a single entity ID string or an array of entity IDs
2. **Timestamps**: Use ISO 8601 format: `"2024-01-01T00:00:00"`
3. **Volume**: Media player volume is 0.0 to 1.0 (0% to 100%)
4. **Brightness**: Light brightness is 0 to 255
5. **Colors**: RGB colors are arrays: `[255, 0, 0]` for red
6. **HVAC Modes**: `off`, `heat`, `cool`, `heat_cool`, `auto`, `dry`, `fan_only`

## Examples

### Morning Routine
```typescript
// Turn on bedroom light gradually
await ha_turn_on_light({
  entity_id: "light.bedroom",
  brightness: 50,
  transition: 30
});

// Set thermostat
await ha_set_temperature({
  entity_id: "climate.bedroom",
  temperature: 22
});

// Start coffee maker
await ha_turn_on_switch({ entity_id: "switch.coffee_maker" });
```

### Movie Night
```typescript
// Activate movie scene
await ha_activate_scene({ entity_id: "scene.movie_time" });

// Adjust media player
await ha_set_volume({
  entity_id: "media_player.living_room",
  volume_level: 0.3
});
```

### Check Temperature History
```typescript
// Get today's temperature readings
const history = await ha_get_history({
  timestamp: "2024-01-01T00:00:00",
  filter_entity_id: "sensor.living_room_temperature",
  end_time: "2024-01-01T23:59:59"
});
```
