---
name: mealie-integration
description: Use when the user wants to create, update, or fix Mealie recipes from NanoClaw, especially when recipes are created with only a title/default content.
---

# Mealie Integration

Use this skill to reliably create or update recipes in Mealie without ending up with title-only stubs.

## Critical API Behavior (must follow)

Mealie `POST /api/recipes` only accepts `{ "name": "..." }` and returns a slug string.
If you send full content in the POST body, Mealie still creates a mostly-default recipe.

Always use the local TypeScript client in `/workspace/group/mealie-integration`:
- `createRecipe(...)` for new recipes
- `updateRecipe(slug, updates)` for existing recipes

These methods implement the correct flow:
1. create stub (or fetch existing)
2. fetch full recipe
3. PUT full merged recipe

## When to Use

- User asks to add a recipe to Mealie
- User asks to fix a broken/empty recipe
- Recipe shows default placeholders (`1 Cup Flour`, markdown demo instruction)

## Workflow

1. **Identify target recipe**
   - Get recipe name/slug from user, or search by name first.

2. **Run update/create via the client**
   - Work in `/workspace/group/mealie-integration`
   - Load credentials first: `set -a && source .env && set +a`
   - Use `npx tsx` with `MealieClient`

3. **Verify content actually persisted**
   - Re-fetch recipe
   - Confirm ingredient/instruction counts are non-trivial
   - Confirm defaults are gone:
     - ingredient note is not `1 Cup Flour`
     - instruction text does not contain `Recipe steps as well as other fields in the recipe page support markdown syntax`

4. **Report back with link + counts**
   - Include URL: `https://mealie.plexico.space/recipe/<slug>`

## Update Template

```bash
cd /workspace/group/mealie-integration && set -a && source .env && set +a && npx tsx - <<'EOF'
import { MealieClient } from './client.ts';

const client = new MealieClient({
  baseUrl: process.env.MEALIE_URL || 'https://mealie.plexico.space',
  apiToken: process.env.MEALIE_TOKEN!,
});

const updated = await client.updateRecipe('<slug>', {
  description: '<description>',
  recipeIngredient: [
    { note: '250g Pasta', display: '250g Pasta', title: null },
  ],
  recipeInstructions: [
    { text: 'Do the thing.' },
  ],
});

console.log(JSON.stringify({
  name: updated.name,
  slug: updated.slug,
  ingredients: updated.recipeIngredient?.length ?? 0,
  instructions: updated.recipeInstructions?.length ?? 0,
}, null, 2));
EOF
```

## Verification Template

```bash
curl -s -H "Authorization: Bearer $MEALIE_TOKEN" \
  "${MEALIE_URL:-https://mealie.plexico.space}/api/recipes/<slug>" \
  | python3 - <<'PY'
import json,sys
r=json.load(sys.stdin)
ings=r.get('recipeIngredient',[])
steps=r.get('recipeInstructions',[])
first_ing=(ings[0].get('note') if ings else '')
first_step=(steps[0].get('text') if steps else '')
print('ingredients=',len(ings))
print('steps=',len(steps))
print('first_ing=',first_ing)
print('first_step=',first_step[:120])
PY
```

## Troubleshooting

- **`Mealie API error (400): Recipe already exists` on PUT**
  - Do not hand-build stripped payloads.
  - Use `MealieClient.updateRecipe` / `createRecipe`, which keeps the full fetched record for PUT.

- **Recipe exists but still default content**
  - Update the recipe by slug; do not recreate repeatedly.
  - Re-run verification and confirm defaults are gone.

- **Auth errors**
  - Ensure `MEALIE_TOKEN` is set in environment (or in `.env` loaded before command).
