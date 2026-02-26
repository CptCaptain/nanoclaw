---
name: ha-status
description: Check status of Home Assistant entities - lights, sensors, switches, climate devices.
---

# Home Assistant - Status

Get the current status of your smart home devices.

## Usage

**/hastatus** - Show overview of all devices
**/hastatus lights** - Show all lights
**/hastatus sensors** - Show all sensors
**/hastatus climate** - Show climate devices
**/hastatus switches** - Show switches
**/hastatus [entity_id]** - Show specific entity details

## Examples

```
/hastatus
/hastatus lights
/hastatus sensor.temperature
/hastatus climate.living_room
```

The command shows:
• Current state (on/off/value)
• Important attributes (brightness, temperature, etc.)
• Last updated time
