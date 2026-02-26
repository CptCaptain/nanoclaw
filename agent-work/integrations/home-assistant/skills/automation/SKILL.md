---
name: ha-automation
description: Trigger and control Home Assistant automations and scenes via WhatsApp.
---

# Home Assistant - Automations & Scenes

Control automations and activate scenes.

## Usage

**/hauto** - List all automations
**/hauto trigger [entity_id]** - Trigger an automation
**/hauto on [entity_id]** - Enable an automation
**/hauto off [entity_id]** - Disable an automation

**/hascene** - List all scenes
**/hascene [entity_id]** - Activate a scene

## Examples

```
/hauto
/hauto trigger automation.morning_routine
/hauto off automation.night_lights

/hascene
/hascene scene.movie_time
/hascene scene.good_night
```
