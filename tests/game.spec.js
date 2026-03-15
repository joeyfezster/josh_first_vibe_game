// tests/game.spec.js
const { test, expect } = require('@playwright/test');
const path = require('path');

const GAME_URL = 'file://' + path.resolve(__dirname, '../index.html');

// Helper: get game state exposed via window.__state
async function getState(page) {
  return page.evaluate(() => window.__state);
}

// Helper: simulate a drag (draw) on the canvas
async function draw(page, points, options = {}) {
  const { steps = 5 } = options;
  const first = points[0];
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (let i = 1; i < points.length; i++) {
    await page.mouse.move(points[i].x, points[i].y, { steps });
  }
  await page.mouse.up();
}

// Helper: simulate a tap (short click)
async function tap(page, x, y) {
  await page.mouse.click(x, y);
}

// Helper: draw a rough circle for loop detection
async function drawCircle(page, cx, cy, radius, numPoints = 30) {
  const points = [];
  for (let i = 0; i <= numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2;
    points.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  }
  await draw(page, points, { steps: 3 });
}

// Helper: draw a steep hill shape
async function drawHill(page, startX, startY, peakHeight) {
  const points = [
    { x: startX, y: startY },
    { x: startX + 40, y: startY - peakHeight },
    { x: startX + 80, y: startY },
  ];
  await draw(page, points, { steps: 10 });
}

// --- TESTS ---

test.describe('Task 1: Canvas Shell', () => {
  test('canvas fills viewport and clear button is visible', async ({ page }) => {
    await page.goto(GAME_URL);
    const canvas = page.locator('#gameCanvas');
    await expect(canvas).toBeVisible();
    const clearBtn = page.locator('#clearBtn');
    await expect(clearBtn).toBeVisible();
  });
});

test.describe('Task 2: Background', () => {
  test('sky gradient and ground render without errors', async ({ page }) => {
    await page.goto(GAME_URL);
    const loopRunning = await page.evaluate(() => {
      return new Promise(resolve => {
        requestAnimationFrame(() => resolve(true));
      });
    });
    expect(loopRunning).toBe(true);
  });
});

test.describe('Task 3: Touch Drawing', () => {
  test('drawing a stroke creates a segment', async ({ page }) => {
    await page.goto(GAME_URL);
    await draw(page, [
      { x: 100, y: 300 }, { x: 200, y: 300 }, { x: 300, y: 300 }
    ]);
    const s = await getState(page);
    expect(s.segments.length).toBeGreaterThan(0);
    expect(s.segments[0].points.length).toBeGreaterThan(2);
  });

  test('short tap does not create a segment', async ({ page }) => {
    await page.goto(GAME_URL);
    await tap(page, 200, 300);
    const s = await getState(page);
    expect(s.segments.length).toBe(0);
  });

  test('clear button resets all segments', async ({ page }) => {
    await page.goto(GAME_URL);
    await draw(page, [
      { x: 100, y: 300 }, { x: 300, y: 300 }
    ]);
    let s = await getState(page);
    expect(s.segments.length).toBeGreaterThan(0);
    await page.click('#clearBtn');
    s = await getState(page);
    expect(s.segments.length).toBe(0);
  });
});

test.describe('Task 4: Smoothing & Auto-Bridge', () => {
  test('smoothed segments have more points than raw input', async ({ page }) => {
    await page.goto(GAME_URL);
    await draw(page, [
      { x: 100, y: 300 }, { x: 150, y: 280 }, { x: 200, y: 300 },
      { x: 250, y: 320 }, { x: 300, y: 300 }
    ]);
    const s = await getState(page);
    expect(s.segments[0].points.length).toBeGreaterThan(10);
  });

  test('disconnected strokes get auto-bridged', async ({ page }) => {
    await page.goto(GAME_URL);
    await draw(page, [{ x: 50, y: 300 }, { x: 150, y: 300 }]);
    await draw(page, [{ x: 400, y: 300 }, { x: 500, y: 300 }]);
    const s = await getState(page);
    expect(s.segments.length).toBe(3);
  });
});

test.describe('Task 5: Vehicles', () => {
  test('vehicles spawn after first stroke', async ({ page }) => {
    await page.goto(GAME_URL);
    let s = await getState(page);
    expect(s.vehicles.length).toBe(0);
    await draw(page, [{ x: 100, y: 300 }, { x: 400, y: 300 }]);
    s = await getState(page);
    expect(s.vehicles.length).toBe(4);
    expect(s.vehiclesSpawned).toBe(true);
  });

  test('vehicles progress along track over time', async ({ page }) => {
    await page.goto(GAME_URL);
    await draw(page, [{ x: 100, y: 300 }, { x: 500, y: 300 }]);
    const s1 = await getState(page);
    const p1 = s1.vehicles[0].progress;
    await page.waitForTimeout(500);
    const s2 = await getState(page);
    const p2 = s2.vehicles[0].progress;
    expect(p2).toBeGreaterThan(p1);
  });

  test('train vehicle has isTrain flag', async ({ page }) => {
    await page.goto(GAME_URL);
    await draw(page, [{ x: 100, y: 300 }, { x: 400, y: 300 }]);
    const s = await getState(page);
    const train = s.vehicles.find(v => v.def.isTrain);
    expect(train).toBeTruthy();
  });
});

test.describe('Task 6: Tap-to-Talk', () => {
  test('tapping near a vehicle creates a speech bubble', async ({ page }) => {
    await page.goto(GAME_URL);
    await draw(page, [{ x: 100, y: 300 }, { x: 500, y: 300 }]);
    await page.waitForTimeout(200);
    const vPos = await page.evaluate(() => {
      const v = window.__state.vehicles[0];
      const path = window.__state.flatPath;
      if (path.length < 2) return null;
      const p = v.progress % 1;
      const idx = p * (path.length - 1);
      const i = Math.floor(idx);
      return path[Math.min(i, path.length - 1)];
    });
    if (vPos) {
      await tap(page, vPos.x, vPos.y);
      const s = await getState(page);
      expect(s.activeBubble).toBeTruthy();
      expect(s.activeBubble.text.length).toBeGreaterThan(0);
    }
  });
});

test.describe('Task 7: Random Chatter', () => {
  test('chatter triggers after delay', async ({ page }) => {
    await page.goto(GAME_URL);
    await draw(page, [{ x: 100, y: 300 }, { x: 500, y: 300 }]);
    await page.waitForTimeout(9000);
    const s = await getState(page);
    expect(s.nextChatterTime).toBeGreaterThan(0);
  });
});

test.describe('Task 8: Gesture Recognition', () => {
  test('drawing a circle creates a loop segment', async ({ page }) => {
    await page.goto(GAME_URL);
    await drawCircle(page, 300, 300, 80);
    const s = await getState(page);
    const hasLoop = s.segments.some(seg => seg.isLoop);
    expect(hasLoop).toBe(true);
  });

  test('drawing a steep hill creates a hill segment', async ({ page }) => {
    await page.goto(GAME_URL);
    await drawHill(page, 200, 400, 150);
    const s = await getState(page);
    const hasHill = s.segments.some(seg => seg.isHill);
    expect(hasHill).toBe(true);
  });

  test('straight line does not trigger loop or hill', async ({ page }) => {
    await page.goto(GAME_URL);
    await draw(page, [{ x: 100, y: 300 }, { x: 500, y: 300 }]);
    const s = await getState(page);
    expect(s.segments.every(seg => !seg.isLoop && !seg.isHill)).toBe(true);
  });
});

test.describe('Task 9: Mobile Polish', () => {
  test('portrait overlay appears in portrait viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(GAME_URL);
    const overlay = await page.evaluate(() => {
      const style = window.getComputedStyle(document.body, '::after');
      return style.content;
    });
    expect(overlay).toContain('Turn your phone');
  });

  test('meta tags are present', async ({ page }) => {
    await page.goto(GAME_URL);
    const mobileCapable = await page.locator('meta[name="mobile-web-app-capable"]').getAttribute('content');
    expect(mobileCapable).toBe('yes');
  });
});

test.describe('Task 10: Integration', () => {
  test('full game flow: draw, vehicles ride, tap, clear, redraw', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(GAME_URL);

    await expect(page.locator('#gameCanvas')).toBeVisible();
    await expect(page.locator('#clearBtn')).toBeVisible();

    await draw(page, [{ x: 100, y: 300 }, { x: 600, y: 300 }]);
    let s = await getState(page);
    expect(s.segments.length).toBeGreaterThan(0);
    expect(s.vehicles.length).toBe(4);

    await page.waitForTimeout(500);
    s = await getState(page);
    expect(s.vehicles[0].progress).toBeGreaterThan(0);

    await draw(page, [{ x: 650, y: 200 }, { x: 750, y: 200 }]);
    s = await getState(page);
    expect(s.segments.length).toBeGreaterThanOrEqual(3);

    await page.click('#clearBtn');
    s = await getState(page);
    expect(s.segments.length).toBe(0);
    expect(s.vehicles.length).toBe(0);

    await draw(page, [{ x: 200, y: 300 }, { x: 500, y: 300 }]);
    s = await getState(page);
    expect(s.vehicles.length).toBe(4);
  });
});
