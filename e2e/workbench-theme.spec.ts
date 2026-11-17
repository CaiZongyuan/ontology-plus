import { expect, test, type Page } from '@playwright/test';

/** The value the page actually resolves for a contract token on the root element. */
const token = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(`--${n}`).trim(), name);

async function expectLook(page: Page, theme: 'default' | 'warm-paper', mode: 'light' | 'dark') {
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-workbench-theme', theme);
  await expect(html).toHaveAttribute('data-theme', mode);
  await expect(page.getByTestId(`workbench-theme-${theme}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId(`theme-pref-${mode}`)).toHaveAttribute('aria-pressed', 'true');
  // Values from the two built-in theme tables (src/packages/workbench-theme/lib/themes).
  const backgrounds = {
    default: { light: '#ffffff', dark: '#101112' },
    'warm-paper': { light: '#f3f2ee', dark: '#121211' },
  } as const;
  await expect.poll(() => token(page, 'background')).toBe(backgrounds[theme][mode]);
  await expect
    .poll(() => token(page, 'font-title'))
    .toMatch(theme === 'default' ? /^"Inter",/ : /^"Noto Serif SC",/);
}

test.describe('Workbench Theme', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('theme and light/dark are chosen independently in settings and the command palette, and survive a reload', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      // Only on the very first load: a device that has never chosen anything.
      if (!sessionStorage.getItem('wb-theme-e2e-started')) {
        sessionStorage.setItem('wb-theme-e2e-started', '1');
        localStorage.removeItem('onto_workbench_theme');
        localStorage.setItem('onto_theme', 'light');
      }
    });
    await page.goto('/?mode=system-settings');

    // A device that has not chosen gets 默认.
    await expectLook(page, 'default', 'light');
    await expect(page.getByTestId('workbench-theme-default')).toHaveText('默认');
    await expect(page.getByTestId('workbench-theme-warm-paper')).toHaveText('暖纸');

    // Switch the theme, then the mode: each applies at once and leaves the other alone.
    await page.getByTestId('workbench-theme-warm-paper').click();
    await expectLook(page, 'warm-paper', 'light');
    await page.getByTestId('theme-pref-dark').click();
    await expectLook(page, 'warm-paper', 'dark');

    await page.reload();
    await expectLook(page, 'warm-paper', 'dark');

    // The command palette switches the theme back; the mode stays dark.
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('command-palette')).toBeVisible();
    await page.getByTestId('command-palette').getByRole('textbox').fill('工作台主题');
    await page.getByTestId('command-palette').getByRole('option', { name: '切换到工作台主题：默认' }).click();
    await expectLook(page, 'default', 'dark');

    await page.reload();
    await expectLook(page, 'default', 'dark');

    // The fourth combination, and the names in English.
    await page.getByTestId('workbench-theme-warm-paper').click();
    await page.getByTestId('theme-pref-light').click();
    await expectLook(page, 'warm-paper', 'light');
    await page.getByTestId('locale-toggle-btn').click();
    await expect(page.getByTestId('workbench-theme-default')).toHaveText('Default');
    await expect(page.getByTestId('workbench-theme-warm-paper')).toHaveText('Warm Paper');
    await page.reload();
    await expectLook(page, 'warm-paper', 'light');
  });

  test('an unknown stored theme falls back to 默认', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('onto_workbench_theme', 'no-such-theme');
      localStorage.setItem('onto_theme', 'light');
    });
    await page.goto('/?mode=system-settings');
    await expectLook(page, 'default', 'light');
  });
});
