import Link from "next/link";
import type { ReactNode } from "react";

export type AdminSectionFrameItem<TSection extends string> = {
  readonly id: TSection;
  readonly href: string;
  readonly icon: ReactNode;
  readonly title: string;
};

export function AdminSectionFrame<TSection extends string>({
  ariaLabel,
  children,
  navTitle,
  sections,
  selectedSection
}: {
  readonly ariaLabel: string;
  readonly children: ReactNode;
  readonly navTitle: string;
  readonly sections: readonly AdminSectionFrameItem<TSection>[];
  readonly selectedSection: TSection;
}): ReactNode {
  return (
    <div className="adminSectionGrid">
      <aside
        className="settingsPanel adminSectionNav"
        aria-labelledby="admin-section-list-title"
      >
        <div className="sectionHeader">
          <div>
            <h2 className="sectionTitle" id="admin-section-list-title">
              {navTitle}
            </h2>
          </div>
        </div>

        <nav className="integrationList" aria-label={ariaLabel}>
          {sections.map((section) => (
            <Link
              className="integrationListItem integrationNavLink adminSectionNavLink"
              href={section.href}
              aria-current={section.id === selectedSection ? "page" : undefined}
              key={section.id}
            >
              <span className="metricIcon">{section.icon}</span>
              <div className="integrationListText">
                <h3 className="listItemTitle">{section.title}</h3>
              </div>
            </Link>
          ))}
        </nav>
      </aside>

      <div className="adminStack adminSectionContent">{children}</div>
    </div>
  );
}
