import React from 'react';
import { Blocks, BarChart3, LayoutGrid, Settings, ShieldCheck } from 'lucide-react';
import { usePreferences } from '../../i18n.js';
import {
  SECONDARY_AREAS,
  type NavViewId,
  type SecondaryAreaId,
} from '../../navigation/index.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';

const AREA_ICONS: Record<SecondaryAreaId, React.ReactNode> = {
  CAPABILITY: <Blocks size={15} aria-hidden="true" />,
  ANALYTICS: <BarChart3 size={15} aria-hidden="true" />,
  GOVERNANCE: <ShieldCheck size={15} aria-hidden="true" />,
};

const AREA_TEST_IDS: Record<SecondaryAreaId, string> = {
  CAPABILITY: 'more-menu-capability',
  ANALYTICS: 'more-menu-analytics',
  GOVERNANCE: 'more-menu-governance',
};

export interface SecondaryMoreMenuProps {
  readonly activeArea?: SecondaryAreaId | null;
  readonly activeView: NavViewId;
  readonly onSelectArea: (area: SecondaryAreaId) => void;
  readonly onSelectSettings: () => void;
}

export function SecondaryMoreMenu({
  activeArea,
  activeView,
  onSelectArea,
  onSelectSettings,
}: SecondaryMoreMenuProps) {
  const { t } = usePreferences();
  const isSecondaryActive = Boolean(activeArea);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`wb-top-btn ${isSecondaryActive ? 'is-active' : ''}`}
        data-testid="more-menu-btn"
        aria-label={t('更多功能入口', 'More areas and settings')}
      >
        <LayoutGrid size={15} aria-hidden="true" />
        <span>{t('更多', 'More')}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-64 p-1.5">
        {SECONDARY_AREAS.map((area) => {
          const isAreaSelected =
            activeArea === area.id &&
            !(area.id === 'GOVERNANCE' && activeView === 'system-settings');
          return (
            <DropdownMenuItem
              key={area.id}
              data-testid={AREA_TEST_IDS[area.id]}
              data-active={isAreaSelected ? 'true' : undefined}
              className="items-start gap-2.5 py-2"
              onClick={() => onSelectArea(area.id)}
            >
              <span className="mt-0.5 text-muted-foreground">{AREA_ICONS[area.id]}</span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[14px] font-medium leading-tight text-popover-foreground">
                  {t(area.label.zh, area.label.en)}
                </span>
                <span className="text-[12px] font-normal leading-snug text-muted-foreground">
                  {t(area.hint.zh, area.hint.en)}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="more-menu-settings"
          data-active={activeView === 'system-settings' ? 'true' : undefined}
          className="items-center gap-2.5 py-2"
          onClick={onSelectSettings}
        >
          <span className="text-muted-foreground">
            <Settings size={15} aria-hidden="true" />
          </span>
          <span className="text-[14px] font-medium leading-tight text-popover-foreground">
            {t('设置', 'Settings')}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
