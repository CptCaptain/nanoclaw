---
name: ha-lights
description: Control Home Assistant lights via WhatsApp. Turn on/off, adjust brightness, change colors.
---

# Home Assistant - Lights Control

Control your lights through Home Assistant.

## Usage

**/lights** - Show all lights and their current states
**/lights on [entity_id]** - Turn on specific light(s)
**/lights off [entity_id]** - Turn off specific light(s)
**/lights toggle [entity_id]** - Toggle specific light(s)
**/lights all on** - Turn on all lights
**/lights all off** - Turn off all lights
**/lights brightness [entity_id] [0-255]** - Set brightness
**/lights color [entity_id] [r,g,b]** - Set RGB color

## Examples

```
/lights
/lights on light.living_room
/lights off light.bedroom
/lights all off
/lights brightness light.kitchen 128
/lights color light.bedroom 255,100,50
```
