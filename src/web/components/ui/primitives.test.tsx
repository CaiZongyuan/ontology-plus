import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { checkWorkbenchSources, formatAppearanceProblems } from '../../../packages/workbench-theme/index.js';
import { Button } from '../beautifui/Button.js';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from './command.js';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog.js';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  Sheet,
  SheetContent,
  SheetTitle,
} from './drawer.js';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu.js';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from './popover.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs.js';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip.js';

function collectWebSources(): Array<{ path: string; content: string }> {
  const rootDir = process.cwd();
  const webDir = path.join(rootDir, 'src', 'web');
  const results: Array<{ path: string; content: string }> = [];

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (/\.(css|tsx?)$/.test(entry.name)) {
        results.push({
          path: path.relative(rootDir, fullPath).replace(/\\/g, '/'),
          content: fs.readFileSync(fullPath, 'utf-8'),
        });
      }
    }
  }

  walk(webDir);
  return results;
}

describe('shadcn/ui Base UI primitives — scoped reset & theme contract', () => {
  it('keeps Tailwind preflight off while defining a [data-slot] scoped reset and passing the appearance guard', () => {
    const tokensCss = fs.readFileSync(path.join(process.cwd(), 'src/web/tokens.css'), 'utf-8');
    expect(tokensCss).not.toContain('tailwindcss/preflight');
    expect(tokensCss).toContain('[data-slot]');

    const problems = checkWorkbenchSources(collectWebSources());
    expect(problems, formatAppearanceProblems(problems)).toEqual([]);
  });
});

describe('Tabs primitive (@base-ui/react/tabs)', () => {
  it('renders tablist, triggers with aria-selected, active panel, and hidden inactive panel using contract tokens', () => {
    const html = renderToStaticMarkup(
      <Tabs defaultValue="objects">
        <TabsList>
          <TabsTrigger value="objects">业务对象</TabsTrigger>
          <TabsTrigger value="rules">业务规则</TabsTrigger>
        </TabsList>
        <TabsContent value="objects" keepMounted>
          合同与甲乙双方
        </TabsContent>
        <TabsContent value="rules" keepMounted>
          金额上限校验
        </TabsContent>
      </Tabs>,
    );

    expect(html).toContain('data-slot="tabs"');
    expect(html).toContain('data-slot="tabs-list"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('data-slot="tabs-trigger"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-selected="false"');
    expect(html).toContain('data-slot="tabs-content"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('合同与甲乙双方');
    expect(html).toMatch(/<div[^>]*hidden=""[^>]*>金额上限校验<\/div>/);
  });
});

describe('Dialog & Drawer primitives (@base-ui/react/dialog)', () => {
  it('composes beautifui Button via Base UI render prop without introducing a competing Button primitive', () => {
    const uiDir = path.join(process.cwd(), 'src/web/components/ui');
    expect(fs.existsSync(path.join(uiDir, 'button.tsx'))).toBe(false);

    const closedHtml = renderToStaticMarkup(
      <Dialog open={false}>
        <DialogTrigger render={<Button variant="accent" />}>打开对话框</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认步骤</DialogTitle>
            <DialogDescription>确认后作为下一步输入</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    expect(closedHtml).toContain('data-slot="dialog-trigger"');
    expect(closedHtml).toContain('bg-primary');
    expect(closedHtml).toContain('打开对话框');
    expect(closedHtml).not.toContain('data-slot="dialog-content"');
  });

  it('renders open Dialog with overlay, header, title, description, footer, close button, and contract tokens', () => {
    const openHtml = renderToStaticMarkup(
      <Dialog open>
        <DialogContent closeLabel="关闭对话框">
          <DialogHeader>
            <DialogTitle>确认需求文档</DialogTitle>
            <DialogDescription>确认后原型步骤将读取此版本。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="secondary" />}>取消</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );

    expect(openHtml).toContain('data-slot="dialog-overlay"');
    expect(openHtml).toContain('data-slot="dialog-content"');
    expect(openHtml).toContain('role="dialog"');
    expect(openHtml).toContain('data-slot="dialog-header"');
    expect(openHtml).toContain('data-slot="dialog-title"');
    expect(openHtml).toContain('确认需求文档');
    expect(openHtml).toContain('data-slot="dialog-description"');
    expect(openHtml).toContain('确认后原型步骤将读取此版本。');
    expect(openHtml).toContain('data-slot="dialog-footer"');
    expect(openHtml).toContain('aria-label="关闭对话框"');
    expect(openHtml).toContain('bg-popover');
    expect(openHtml).toContain('shadow-overlay');
  });

  it('renders slide-over Drawer (and Sheet alias) across sides using contract tokens', () => {
    const drawerHtml = renderToStaticMarkup(
      <Drawer open>
        <DrawerTrigger render={<Button variant="secondary" />}>技术细节</DrawerTrigger>
        <DrawerContent side="right" closeLabel="关闭抽屉">
          <DrawerHeader>
            <DrawerTitle>业务模型技术细节</DrawerTitle>
            <DrawerDescription>查看底层模型结构与校验详情</DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <DrawerClose render={<Button variant="secondary" />}>完成</DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>,
    );

    expect(drawerHtml).toContain('data-slot="drawer-overlay"');
    expect(drawerHtml).toContain('data-slot="drawer-content"');
    expect(drawerHtml).toContain('data-side="right"');
    expect(drawerHtml).toContain('role="dialog"');
    expect(drawerHtml).toContain('data-slot="drawer-title"');
    expect(drawerHtml).toContain('业务模型技术细节');
    expect(drawerHtml).toContain('aria-label="关闭抽屉"');

    const leftSheetHtml = renderToStaticMarkup(
      <Sheet open>
        <SheetContent side="left">
          <SheetTitle>对话抽屉</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(leftSheetHtml).toContain('data-side="left"');
    expect(leftSheetHtml).toContain('对话抽屉');
  });
});

describe('Popover & Tooltip primitives (@base-ui/react/popover, @base-ui/react/tooltip)', () => {
  it('renders Popover trigger, positioned content, header, title, description, and close control with contract tokens', () => {
    const closedHtml = renderToStaticMarkup(
      <Popover open={false}>
        <PopoverTrigger render={<Button variant="secondary" />}>筛选条件</PopoverTrigger>
        <PopoverContent>
          <PopoverTitle>按状态筛选</PopoverTitle>
        </PopoverContent>
      </Popover>,
    );
    expect(closedHtml).toContain('data-slot="popover-trigger"');
    expect(closedHtml).not.toContain('data-slot="popover-content"');

    const openHtml = renderToStaticMarkup(
      <Popover open>
        <PopoverTrigger render={<Button variant="secondary" />}>筛选条件</PopoverTrigger>
        <PopoverContent side="bottom" align="start">
          <PopoverHeader>
            <PopoverTitle>步骤说明</PopoverTitle>
            <PopoverDescription>上游需求已更新，可按需同步。</PopoverDescription>
          </PopoverHeader>
          <PopoverClose render={<Button size="xs" />}>知道了</PopoverClose>
        </PopoverContent>
      </Popover>,
    );

    expect(openHtml).toContain('data-slot="popover-positioner"');
    expect(openHtml).toContain('data-slot="popover-content"');
    expect(openHtml).toContain('data-side="bottom"');
    expect(openHtml).toContain('data-align="start"');
    expect(openHtml).toContain('data-slot="popover-header"');
    expect(openHtml).toContain('data-slot="popover-title"');
    expect(openHtml).toContain('步骤说明');
    expect(openHtml).toContain('data-slot="popover-description"');
    expect(openHtml).toContain('data-slot="popover-close"');
    expect(openHtml).toContain('bg-popover');
    expect(openHtml).toContain('shadow-raised');
  });

  it('renders Tooltip with TooltipProvider, trigger, and positioned tooltip popup using contract tokens', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider delay={200}>
        <Tooltip open>
          <TooltipTrigger render={<Button variant="ghost" size="xs" />}>?</TooltipTrigger>
          <TooltipContent side="top">确认需求文档后才可进入原型设计</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    expect(html).toContain('data-slot="tooltip-trigger"');
    expect(html).toContain('data-slot="tooltip-positioner"');
    expect(html).toContain('data-slot="tooltip-content"');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('data-side="top"');
    expect(html).toContain('确认需求文档后才可进入原型设计');
    expect(html).toContain('bg-popover');
  });
});

describe('DropdownMenu primitive (@base-ui/react/menu)', () => {
  it('renders menu groups, items (default & destructive), checkbox/radio items, shortcuts, separators, and submenus with contract tokens', () => {
    const html = renderToStaticMarkup(
      <DropdownMenu open>
        <DropdownMenuTrigger render={<Button variant="secondary" />}>更多</DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuLabel>次级入口</DropdownMenuLabel>
            <DropdownMenuItem>
              能力中心
              <DropdownMenuShortcut>⌘1</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>数据分析中心</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem checked>显示技术细节</DropdownMenuCheckboxItem>
          <DropdownMenuRadioGroup value="warm-paper">
            <DropdownMenuRadioItem value="default">默认</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="warm-paper">暖纸</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuSub open>
            <DropdownMenuSubTrigger>对话历史</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuGroup>
                <DropdownMenuItem>切换到上一轮会话</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive">删除会话</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(html).toContain('data-slot="dropdown-menu-trigger"');
    expect(html).toContain('data-slot="dropdown-menu-content"');
    expect(html).toContain('role="menu"');
    expect(html).toContain('data-slot="dropdown-menu-group"');
    expect(html).toContain('role="group"');
    expect(html).toContain('data-slot="dropdown-menu-label"');
    expect(html).toContain('次级入口');
    expect(html).toContain('data-slot="dropdown-menu-item"');
    expect(html).toContain('role="menuitem"');
    expect(html).toContain('data-slot="dropdown-menu-shortcut"');
    expect(html).toContain('⌘1');
    expect(html).toContain('data-slot="dropdown-menu-checkbox-item"');
    expect(html).toContain('role="menuitemcheckbox"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('data-slot="dropdown-menu-radio-item"');
    expect(html).toContain('role="menuitemradio"');
    expect(html).toContain('data-slot="dropdown-menu-separator"');
    expect(html).toContain('data-slot="dropdown-menu-sub-trigger"');
    expect(html).toContain('data-slot="dropdown-menu-sub-content"');
    expect(html).toContain('切换到上一轮会话');
    expect(html).toContain('data-variant="destructive"');
    expect(html).toContain('text-destructive');
    expect(html).toContain('bg-popover');
    expect(html).toContain('shadow-raised');
  });
});

describe('Command & CommandDialog primitives (combobox/listbox + @base-ui/react/dialog)', () => {
  function renderPalette(search?: string, shouldFilter = true) {
    return renderToStaticMarkup(
      <Command defaultSearch={search} shouldFilter={shouldFilter}>
        <CommandInput placeholder="搜索项目、步骤或业务对象…" />
        <CommandList>
          <CommandEmpty>没有匹配的结果</CommandEmpty>
          <CommandGroup heading="业务对象">
            <CommandItem value="contract" keywords={['合同', '履约']}>
              合同
              <CommandShortcut>↵</CommandShortcut>
            </CommandItem>
            <CommandItem value="supplier" keywords={['供应商', '准入']} disabled>
              供应商
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="步骤">
            <CommandItem value="step-req" keywords={['需求', '文档']}>
              需求
            </CommandItem>
            <CommandItem value="step-proto" keywords={['原型', '界面']}>
              原型
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    );
  }

  it('renders combobox input, listbox groups, options, active selection, and hides empty state when items match', () => {
    const html = renderPalette('');

    expect(html).toContain('data-slot="command"');
    expect(html).toContain('data-slot="command-input-wrapper"');
    expect(html).toContain('data-slot="command-input"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('data-slot="command-list"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('data-slot="command-group"');
    expect(html).toContain('业务对象');
    expect(html).toContain('步骤');
    expect(html).toContain('data-slot="command-item"');
    expect(html).toContain('role="option"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('data-slot="command-shortcut"');
    expect(html).toContain('data-slot="command-separator"');
    expect(html).not.toContain('没有匹配的结果');
  });

  it('filters items and groups by search query + keywords, hides empty groups, and displays CommandEmpty on zero matches', () => {
    const filteredHtml = renderPalette('原型 界面');
    expect(filteredHtml).toContain('>原型<');
    expect(filteredHtml).toContain('>步骤<');
    expect(filteredHtml).toContain('aria-activedescendant=');
    expect(filteredHtml).toContain('item-step-proto');
    expect(filteredHtml).not.toContain('>合同<');
    expect(filteredHtml).not.toContain('>业务对象<');
    expect(filteredHtml).not.toContain('没有匹配的结果');

    const emptyHtml = renderPalette('不存在的对象词条');
    expect(emptyHtml).toContain('data-slot="command-empty"');
    expect(emptyHtml).toContain('没有匹配的结果');
    expect(emptyHtml).not.toContain('data-slot="command-item"');

    const unfilteredHtml = renderPalette('不存在的对象词条', false);
    expect(unfilteredHtml).toContain('合同');
    expect(unfilteredHtml).toContain('原型');
    expect(unfilteredHtml).not.toContain('没有匹配的结果');
  });

  it('skips disabled CommandItem when selecting initial active option and honors controlled value', () => {
    const skipDisabledHtml = renderToStaticMarkup(
      <Command>
        <CommandInput placeholder="搜索…" />
        <CommandList>
          <CommandGroup heading="操作">
            <CommandItem value="disabled-first" disabled>
              不可用项
            </CommandItem>
            <CommandItem value="enabled-second">可用项</CommandItem>
            <CommandItem value="enabled-third">第三项</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    );
    expect(skipDisabledHtml).toMatch(/data-value="disabled-first"[^>]*data-disabled=""/);
    expect(skipDisabledHtml).toMatch(/aria-selected="true"[^>]*data-slot="command-item"[^>]*data-value="enabled-second"/);

    const controlledHtml = renderToStaticMarkup(
      <Command value="enabled-third">
        <CommandInput placeholder="搜索…" />
        <CommandList>
          <CommandGroup heading="操作">
            <CommandItem value="enabled-second">可用项</CommandItem>
            <CommandItem value="enabled-third">第三项</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    );
    expect(controlledHtml).toMatch(/aria-selected="true"[^>]*data-slot="command-item"[^>]*data-value="enabled-third"/);
  });

  it('renders CommandDialog wrapping Command inside an accessible Dialog', () => {
    const dialogHtml = renderToStaticMarkup(
      <CommandDialog open title="命令面板" description="搜索并跳转到项目、步骤或业务对象">
        <CommandInput placeholder="输入关键词…" />
        <CommandList>
          <CommandGroup heading="项目">
            <CommandItem value="clm">合同全生命周期管理系统</CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>,
    );

    expect(dialogHtml).toContain('data-slot="dialog-content"');
    expect(dialogHtml).toContain('data-slot="command"');
    expect(dialogHtml).toContain('命令面板');
    expect(dialogHtml).toContain('合同全生命周期管理系统');
  });

  it('re-exports all 7 foundational UI primitive families from ui/index.ts', async () => {
    const barrel = await import('./index.js');
    expect(barrel.Dialog).toBeDefined();
    expect(barrel.Popover).toBeDefined();
    expect(barrel.Tabs).toBeDefined();
    expect(barrel.Tooltip).toBeDefined();
    expect(barrel.DropdownMenu).toBeDefined();
    expect(barrel.Command).toBeDefined();
    expect(barrel.CommandDialog).toBeDefined();
    expect(barrel.Drawer).toBeDefined();
    expect(barrel.Sheet).toBeDefined();
  });
});




