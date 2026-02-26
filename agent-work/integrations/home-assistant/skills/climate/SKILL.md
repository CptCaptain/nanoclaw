---
name: ha-climate
description: Control Home Assistant climate devices (thermostats, AC, heating) via WhatsApp.
---

# Home Assistant - Climate Control

Control your thermostats and climate devices.

## Usage

**/climate** - Show all climate devices and their current states
**/climate temp [entity_id] [temperature]** - Set temperature
**/climate mode [entity_id] [mode]** - Set HVAC mode (off, heat, cool, auto, etc.)

## Modes

- off - Turn off
- heat - Heating mode
- cool - Cooling mode
- heat_cool - Auto heating/cooling
- auto - Automatic mode
- dry - Dehumidify
- fan_only - Fan only

## Examples

```
/climate
/climate temp climate.living_room 22
/climate mode climate.bedroom heat
/climate mode climate.office off
```
