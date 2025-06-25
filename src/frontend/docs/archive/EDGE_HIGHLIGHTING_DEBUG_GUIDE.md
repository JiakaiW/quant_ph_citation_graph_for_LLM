# 🔗 Edge Highlighting Debug Guide

## Issue Description
When clicking on a node, the original grey edges disappear but new highlighted edges don't appear. When clicking elsewhere, the edges should be restored but they're not coming back.

## Debug Steps

### 1. Open Browser Developer Tools
1. Navigate to `http://localhost:5174`
2. Press `F12` to open developer tools
3. Go to the **Console** tab
4. Clear the console (`Ctrl+L` or `Cmd+K`)

### 2. Test Node Click Highlighting

#### Click on any node and look for these console messages:

**Expected Output (Step by Step):**
```
🎨 Highlighting node [NODE_ID] with depth 1
🎨 Found [N] nodes and [M] edges to highlight
🔍 Looking for edges connecting [N] highlighted nodes
🔍 Highlighted nodes: ["node1", "node2", "node3", ...]
🔍 Found edge to highlight: [EDGE_ID] ([SOURCE] -> [TARGET])
🔍 Found [M] edges to highlight out of [TOTAL] total edges
💾 Stored original style for edge [EDGE_ID]: {color: "...", size: ..., opacity: ...}
🎨 Highlighting [M] edges with Z-order fix
🎨 Edge [EDGE_ID] before highlighting: {color: "...", size: ..., opacity: ...}
🎨 Re-added edge [EDGE_ID] with highlighted style: {color: "#ff4444", size: 8, opacity: 1}
🎨 Applied Z-order highlighting to [M] edges - they should now appear on top
🎨 Highlighted [N] nodes and [M] edges
```

### 3. Test Clear Highlighting

#### Click elsewhere (empty space) and look for these console messages:

**Expected Output:**
```
🎨 Clearing highlights
🎨 Restoring [N] nodes and [M] edges
🔄 Edge [EDGE_ID] before restore: {color: "#ff4444", size: 8, opacity: 1}
🔄 Restored edge [EDGE_ID] to original style: {color: "...", size: ..., opacity: ...}
🔄 Restored [M] edges to original Z-order and styling
```

## Common Issues & Troubleshooting

### Issue 1: No edges found to highlight
**Symptoms:** `🔍 Found 0 edges to highlight`
**Possible Causes:**
- The clicked node has no neighbors in the current graph
- The neighbors are not loaded in the current viewport
- Edge finding logic is incorrect

**Debug Steps:**
1. Check if the node has neighbors: Look for the highlighted nodes list
2. If neighbors exist but no edges found, there's a logic issue

### Issue 2: Edges disappear and don't come back
**Symptoms:** Edges vanish on click, console shows highlighting messages, but edges not visible
**Possible Causes:**
- Edge color is same as background
- Edge size is too small
- Edge opacity is 0
- **Z-order issue**: Highlighted edges rendered behind other edges
- Sigma.js rendering issue

**Debug Steps:**
1. Check the "Re-added edge with highlighted style" console messages - are the values correct?
2. Look for edge color `#ff4444` (bright red) and size `8` (2x multiplier)
3. Look for "Applied Z-order highlighting" message - this ensures edges render on top
4. Try zooming in/out to see if edges appear

### Issue 3: Edges not restored when clearing
**Symptoms:** Clicking elsewhere doesn't restore original edges
**Possible Causes:**
- Original styles not stored correctly
- Restore logic not working
- clearHighlight not being called

**Debug Steps:**
1. Check if clearHighlight is called when clicking empty space
2. Verify original styles were stored (look for 💾 messages)
3. Check if restore messages appear with correct values

### Issue 4: TypeScript/Build errors affecting functionality
**Symptoms:** Changes not reflected, console errors
**Solutions:**
1. The dev server should hot-reload automatically
2. If not, restart the dev server: `npm run dev`
3. TypeScript errors in build don't affect dev mode

## Expected Visual Behavior

### When clicking a node:
1. **Clicked node**: Bright red (#ff6b6b), larger size
2. **Neighbor nodes**: Teal (#4ecdc4), medium size  
3. **Connected edges**: Bright red (#ff4444), thick (size 8, 2x multiplier)
4. **Other nodes**: Faded to 15% opacity
5. **Other edges**: Faded to 15% opacity

### When clicking elsewhere:
1. All nodes return to original colors and sizes
2. All edges return to original colors and sizes
3. All opacity returns to 100%

## Manual Testing Checklist

- [ ] Node highlighting works (clicked node turns red)
- [ ] Neighbor highlighting works (neighbors turn teal)
- [ ] Node fading works (other nodes fade to 15%)
- [ ] Edge highlighting works (connected edges turn red and thick)
- [ ] Edge fading works (other edges fade to 15%)
- [ ] Clear highlighting works (click elsewhere restores everything)
- [ ] Console shows expected debug messages
- [ ] No JavaScript errors in console

## Configuration Check

The highlighting configuration should be:
```typescript
focusNodeColor: '#ff6b6b'     // Bright red for clicked node
neighborNodeColor: '#4ecdc4'   // Teal for neighbors  
focusEdgeColor: '#ff4444'      // Bright red for edges
focusEdgeSize: 4               // Base edge size (multiplied by 1.5 = 6)
fadeOpacity: 0.15              // 15% opacity for faded elements
```

## If Nothing Works

1. **Check if click events are registered:**
   - Look for any console messages when clicking nodes
   - If no messages, the click handler isn't working

2. **Check if GraphManager is initialized:**
   - Look for GraphManager initialization messages
   - Check if NodeClickHighlighter is created

3. **Restart everything:**
   ```bash
   # Stop frontend (Ctrl+C in the terminal running npm run dev)
   # Stop backend (Ctrl+C in the terminal running python backend_fastapi.py)
   
   # Restart backend
   cd src/frontend
   python backend_fastapi.py
   
   # Restart frontend (in new terminal)
   cd src/frontend  
   npm run dev
   ```

4. **Check browser compatibility:**
   - Try a different browser (Chrome, Firefox, Safari)
   - Clear browser cache and cookies
   - Disable browser extensions

## Report Back

When testing, please report:
1. **What console messages you see** (copy/paste the actual output)
2. **What visual behavior you observe** 
3. **Any JavaScript errors** in the console
4. **Which step in the process fails** (finding edges, highlighting edges, restoring edges)

This will help pinpoint the exact issue and fix it quickly. 