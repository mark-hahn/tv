# Tablet Sizing Configuration

All sizing values for the tablet layout are controlled by a single `sizing` object in `App.vue`.

## Location
**File:** `src/components/App.vue`  
**Object:** `sizing` (in the `data()` section)

## Current Values

### List Pane
- `listWidth: '500px'` - Width of the entire list pane (default: 800px)

### Series Pane  
- `seriesWidth: '450px'` - Width of series pane (default: auto)
- `posterWidth: '140px'` - Poster image max width (default: 300px)
- `posterHeight: '210px'` - Poster image max height (default: 400px)
- `seriesFontSize: '18px'` - Series title font size (default: 25px)
- `seriesInfoFontSize: '14px'` - Info box text size (default: 17px)
- `seriesInfoWidth: '200px'` - Info box width (default: 250px)
- `remotesWidth: '210px'` - Remotes area width (default: 260px)
- `remoteButtonPadding: '6px'` - Padding inside remote buttons (default: 10px)
- `remoteFontSize: '13px'` - Remote button text size (default: inherit)
- `watchButtonPadding: '8px 12px'` - Padding for watch buttons (default: 3px)
- `watchButtonFontSize: '13px'` - Watch button text size (default: inherit)
- `emailWidth: '150px'` - Email textarea width (default: 200px)

### Buttons Pane
- `buttonHeight: '28px'` - Height of all buttons (default: 40px)
- `buttonFontSize: '13px'` - Button text size (default: 15px)
- `buttonPadding: '8px 6px'` - Button padding (default: 12px 8px)
- `buttonMarginBottom: '6px'` - Space between buttons (default: 8px)

## How to Adjust

1. Open `src/components/App.vue`
2. Find the `sizing` object in the `data()` section (around line 45)
3. Change any values you want
4. Save and refresh the page

## Tips

- All values are CSS size strings, so you can use px, em, rem, %, etc.
- Start with small adjustments (±20-50px) to see the effect
- The defaults (shown in comments) are the laptop sizes
- Test after each change to see the impact
- If you set a value to null/undefined, it will use the default

## Example Adjustments

**Make everything even smaller:**
```javascript
listWidth: '400px',
seriesWidth: '350px',
posterWidth: '120px',
posterHeight: '180px',
buttonHeight: '24px',
```

**Make buttons taller but fewer overall:**
```javascript
buttonHeight: '36px',
buttonPadding: '10px 8px',
buttonMarginBottom: '8px',
```
