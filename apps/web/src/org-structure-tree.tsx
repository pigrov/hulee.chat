"use client";

import type { OrgUnitKind, OrgUnitRecord } from "@hulee/db";
import {
  Archive,
  ArchiveRestore,
  Building2,
  ChevronDown,
  ChevronRight,
  GripVertical,
  LoaderCircle,
  Save
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type DragEvent,
  type ReactNode
} from "react";
import { useFormStatus } from "react-dom";

import {
  moveOrgUnitParentAction,
  setOrgUnitStatusAction,
  upsertOrgUnitAction
} from "./org-structure-actions";
import {
  buildOrgUnitTreeState,
  canMoveOrgUnit,
  expandableOrgUnitIds,
  ROOT_PARENT_ID,
  type OrgUnitTreeDerivedState,
  type OrgUnitTreeRow
} from "./org-structure-tree-model";

export type OrgUnitKindOption = {
  readonly id: OrgUnitKind;
  readonly label: string;
};

export type OrgUnitTreeLabels = {
  readonly archive: string;
  readonly archivedStatus: string;
  readonly activeStatus: string;
  readonly childCountTemplate: string;
  readonly collapse: string;
  readonly dragHandle: string;
  readonly dropOnRoot: string;
  readonly expand: string;
  readonly kind: string;
  readonly moveFailed: string;
  readonly moving: string;
  readonly name: string;
  readonly noOrgUnits: string;
  readonly noParent: string;
  readonly parentOrgUnit: string;
  readonly restore: string;
  readonly root: string;
  readonly rootDescription: string;
  readonly save: string;
};

export function OrgUnitTree({
  kindOptions,
  labels,
  locale,
  orgUnits
}: {
  readonly kindOptions: readonly OrgUnitKindOption[];
  readonly labels: OrgUnitTreeLabels;
  readonly locale: string;
  readonly orgUnits: readonly OrgUnitRecord[];
}): ReactNode {
  const router = useRouter();
  const [draftOrgUnits, setDraftOrgUnits] = useState(orgUnits);
  const [expandedUnitIds, setExpandedUnitIds] = useState<ReadonlySet<string>>(
    () => expandableOrgUnitIds(orgUnits)
  );
  const [draggedUnitId, setDraggedUnitId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState(false);
  const [pendingMoveId, setPendingMoveId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const derived = useMemo(
    () =>
      buildOrgUnitTreeState({
        expandedUnitIds,
        locale,
        orgUnits: draftOrgUnits
      }),
    [draftOrgUnits, expandedUnitIds, locale]
  );

  useEffect(() => {
    setDraftOrgUnits(orgUnits);
    setExpandedUnitIds((current) => {
      const expandableIds = expandableOrgUnitIds(orgUnits);
      const next = new Set<string>();

      for (const id of current) {
        if (expandableIds.has(id)) {
          next.add(id);
        }
      }

      for (const id of expandableIds) {
        if (!current.has(id)) {
          next.add(id);
        }
      }

      return next;
    });
  }, [orgUnits]);

  const toggleExpanded = (orgUnitId: string): void => {
    setExpandedUnitIds((current) => {
      const next = new Set(current);

      if (next.has(orgUnitId)) {
        next.delete(orgUnitId);
      } else {
        next.add(orgUnitId);
      }

      return next;
    });
  };
  const canDropOn = (draggedId: string | null, targetParentId: string | null) =>
    canMoveOrgUnit({
      descendantsByUnit: derived.descendantsByUnit,
      draggedId,
      targetParentId,
      unitsById: derived.unitsById
    });
  const handleDrop = (targetParentId: string | null): void => {
    const draggedId = draggedUnitId;
    const draggedUnit =
      draggedId === null ? undefined : derived.unitsById.get(draggedId);

    setDropTargetId(null);

    if (draggedUnit === undefined || !canDropOn(draggedId, targetParentId)) {
      return;
    }

    setMoveError(false);
    setPendingMoveId(draggedUnit.id);

    const formData = new FormData();
    formData.set("id", draggedUnit.id);
    formData.set("section", "org_units");

    if (targetParentId !== null) {
      formData.set("parentOrgUnitId", targetParentId);
    }

    const previousOrgUnits = draftOrgUnits;
    setDraftOrgUnits((current) =>
      current.map((orgUnit) =>
        orgUnit.id === draggedUnit.id
          ? {
              ...orgUnit,
              parentOrgUnitId: targetParentId
            }
          : orgUnit
      )
    );
    setExpandedUnitIds((current) => {
      const next = new Set(current);

      if (targetParentId !== null) {
        next.add(targetParentId);
      }

      return next;
    });

    startTransition(() => {
      void moveOrgUnitParentAction(formData)
        .then((result) => {
          if (result.status !== "saved") {
            setDraftOrgUnits(previousOrgUnits);
            setMoveError(true);
            return;
          }

          router.refresh();
        })
        .catch(() => {
          setDraftOrgUnits(previousOrgUnits);
          setMoveError(true);
        })
        .finally(() => {
          setDraggedUnitId(null);
          setPendingMoveId(null);
        });
    });
  };

  if (draftOrgUnits.length === 0) {
    return (
      <div className="managementList orgStructureTreeList">
        <p className="metaText">{labels.noOrgUnits}</p>
      </div>
    );
  }

  const canDropOnRoot = canDropOn(draggedUnitId, null);

  return (
    <div className="managementList orgStructureTreeList">
      <div
        className="orgStructureTreeRoot"
        data-drop-invalid={
          dropTargetId === ROOT_PARENT_ID && !canDropOnRoot ? "true" : "false"
        }
        data-drop-target={
          dropTargetId === ROOT_PARENT_ID && canDropOnRoot ? "true" : "false"
        }
        title={labels.dropOnRoot}
        onDragOver={(event) => {
          handleDragOver(event, canDropOnRoot, () =>
            setDropTargetId(ROOT_PARENT_ID)
          );
        }}
        onDragLeave={() => setDropTargetId(null)}
        onDrop={(event) => {
          event.preventDefault();
          handleDrop(null);
        }}
      >
        <span className="metricIcon">
          <Building2 size={18} aria-hidden="true" />
        </span>
        <div className="minWidthZero">
          <p className="sectionTitle">{labels.root}</p>
          <p className="metaText">{labels.rootDescription}</p>
          {moveError ? (
            <p className="telegramConnectionNotice" data-variant="error">
              {labels.moveFailed}
            </p>
          ) : null}
        </div>
        <span className="badge">{derived.allRows.length}</span>
      </div>

      {derived.visibleRows.map((row) => (
        <OrgUnitTreeItem
          key={row.orgUnit.id}
          canDropOn={canDropOn}
          derived={derived}
          draggedUnitId={draggedUnitId}
          dropTargetId={dropTargetId}
          expanded={expandedUnitIds.has(row.orgUnit.id)}
          kindOptions={kindOptions}
          labels={labels}
          pendingMoveId={pendingMoveId}
          row={row}
          setDraggedUnitId={setDraggedUnitId}
          setDropTargetId={setDropTargetId}
          toggleExpanded={toggleExpanded}
          onDrop={handleDrop}
        />
      ))}
    </div>
  );
}

function OrgUnitTreeItem({
  canDropOn,
  derived,
  draggedUnitId,
  dropTargetId,
  expanded,
  kindOptions,
  labels,
  onDrop,
  pendingMoveId,
  row,
  setDraggedUnitId,
  setDropTargetId,
  toggleExpanded
}: {
  readonly canDropOn: (
    draggedId: string | null,
    targetParentId: string | null
  ) => boolean;
  readonly derived: OrgUnitTreeDerivedState;
  readonly draggedUnitId: string | null;
  readonly dropTargetId: string | null;
  readonly expanded: boolean;
  readonly kindOptions: readonly OrgUnitKindOption[];
  readonly labels: OrgUnitTreeLabels;
  readonly onDrop: (targetParentId: string | null) => void;
  readonly pendingMoveId: string | null;
  readonly row: OrgUnitTreeRow;
  readonly setDraggedUnitId: (orgUnitId: string | null) => void;
  readonly setDropTargetId: (orgUnitId: string | null) => void;
  readonly toggleExpanded: (orgUnitId: string) => void;
}): ReactNode {
  const { childCount, depth, orgUnit } = row;
  const nextStatus = orgUnit.status === "active" ? "archived" : "active";
  const visualDepth = Math.min(depth, 8);
  const isDragging = draggedUnitId === orgUnit.id;
  const isDropTarget = dropTargetId === orgUnit.id;
  const dropAllowed = canDropOn(draggedUnitId, orgUnit.id);
  const parentOptions = derived.allRows.filter((parentRow) => {
    if (parentRow.orgUnit.id === orgUnit.id) {
      return false;
    }

    return !derived.descendantsByUnit
      .get(orgUnit.id)
      ?.has(parentRow.orgUnit.id);
  });

  return (
    <article
      className="managementRow orgStructureRow orgStructureTreeRow"
      data-depth={depth}
      data-dragging={isDragging ? "true" : "false"}
      data-drop-invalid={isDropTarget && !dropAllowed ? "true" : "false"}
      data-drop-target={isDropTarget && dropAllowed ? "true" : "false"}
      style={{ paddingLeft: `${14 + visualDepth * 24}px` }}
      onDragOver={(event) => {
        handleDragOver(event, dropAllowed, () => setDropTargetId(orgUnit.id));
      }}
      onDragLeave={() => setDropTargetId(null)}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(orgUnit.id);
      }}
    >
      <div className="orgStructureTreeControls">
        <button
          className="orgStructureDragHandle"
          draggable
          type="button"
          aria-label={`${labels.dragHandle}: ${orgUnit.name}`}
          title={labels.dragHandle}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", orgUnit.id);
            setDraggedUnitId(orgUnit.id);
          }}
          onDragEnd={() => {
            setDraggedUnitId(null);
            setDropTargetId(null);
          }}
        >
          <GripVertical size={16} aria-hidden="true" />
        </button>
        <button
          className="orgStructureTreeToggle"
          type="button"
          aria-expanded={childCount > 0 ? expanded : undefined}
          aria-label={
            childCount > 0
              ? `${expanded ? labels.collapse : labels.expand}: ${orgUnit.name}`
              : orgUnit.name
          }
          disabled={childCount === 0}
          onClick={() => toggleExpanded(orgUnit.id)}
        >
          {childCount > 0 ? (
            expanded ? (
              <ChevronDown size={18} aria-hidden="true" />
            ) : (
              <ChevronRight size={18} aria-hidden="true" />
            )
          ) : (
            <Building2 size={18} aria-hidden="true" />
          )}
        </button>
      </div>

      <div className="orgStructureTreeRowBody">
        <div className="orgStructureTreeRowHeader">
          <div className="minWidthZero">
            <p className="orgStructureTreeTitle">{orgUnit.name}</p>
            <p className="metaText">
              {kindLabel(kindOptions, orgUnit.kind)} /{" "}
              {formatCount(labels.childCountTemplate, childCount)}
            </p>
          </div>
          {pendingMoveId === orgUnit.id ? (
            <span className="badge">
              <LoaderCircle
                className="buttonSpinner"
                size={14}
                aria-hidden="true"
              />
              {labels.moving}
            </span>
          ) : null}
        </div>
        <form
          className="settingsForm orgStructureInlineForm"
          action={upsertOrgUnitAction}
        >
          <input name="section" type="hidden" value="org_units" />
          <input name="id" type="hidden" value={orgUnit.id} />
          <OrgUnitNameInput defaultValue={orgUnit.name} labels={labels} />
          <OrgUnitKindSelect
            defaultValue={orgUnit.kind}
            kindOptions={kindOptions}
            labels={labels}
          />
          <OrgUnitParentSelect
            defaultValue={orgUnit.parentOrgUnitId ?? ""}
            labels={labels}
            parentOptions={parentOptions}
          />
          <SubmitButton className="secondaryButton" label={labels.save}>
            <Save size={14} aria-hidden="true" />
          </SubmitButton>
        </form>
      </div>

      <div className="rowActions">
        <span className="badge">
          {orgUnit.status === "active"
            ? labels.activeStatus
            : labels.archivedStatus}
        </span>
        <form className="inlineForm" action={setOrgUnitStatusAction}>
          <input name="section" type="hidden" value="org_units" />
          <input name="id" type="hidden" value={orgUnit.id} />
          <input name="status" type="hidden" value={nextStatus} />
          <SubmitButton
            className={
              orgUnit.status === "active" ? "dangerButton" : "secondaryButton"
            }
            label={
              orgUnit.status === "active" ? labels.archive : labels.restore
            }
          >
            {orgUnit.status === "active" ? (
              <Archive size={14} aria-hidden="true" />
            ) : (
              <ArchiveRestore size={14} aria-hidden="true" />
            )}
          </SubmitButton>
        </form>
      </div>
    </article>
  );
}

function OrgUnitNameInput({
  defaultValue,
  labels
}: {
  readonly defaultValue: string;
  readonly labels: OrgUnitTreeLabels;
}): ReactNode {
  return (
    <label className="fieldStack">
      <span className="detailLabel">{labels.name}</span>
      <input
        className="textInput"
        defaultValue={defaultValue}
        maxLength={120}
        name="name"
        required
        type="text"
      />
    </label>
  );
}

function OrgUnitKindSelect({
  defaultValue,
  kindOptions,
  labels
}: {
  readonly defaultValue: OrgUnitKind;
  readonly kindOptions: readonly OrgUnitKindOption[];
  readonly labels: OrgUnitTreeLabels;
}): ReactNode {
  return (
    <label className="fieldStack">
      <span className="detailLabel">{labels.kind}</span>
      <select
        className="selectInput"
        defaultValue={defaultValue}
        name="kind"
        required
      >
        {kindOptions.map((kind) => (
          <option key={kind.id} value={kind.id}>
            {kind.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function OrgUnitParentSelect({
  defaultValue,
  labels,
  parentOptions
}: {
  readonly defaultValue: string;
  readonly labels: OrgUnitTreeLabels;
  readonly parentOptions: readonly OrgUnitTreeRow[];
}): ReactNode {
  return (
    <label className="fieldStack">
      <span className="detailLabel">{labels.parentOrgUnit}</span>
      <select
        key={defaultValue}
        className="selectInput"
        defaultValue={defaultValue}
        name="parentOrgUnitId"
      >
        <option value="">{labels.noParent}</option>
        {parentOptions.map((row) => (
          <option key={row.orgUnit.id} value={row.orgUnit.id}>
            {`${"  ".repeat(row.depth)}${row.orgUnit.name}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function SubmitButton({
  children,
  className,
  label
}: {
  readonly children: ReactNode;
  readonly className: string;
  readonly label: string;
}): ReactNode {
  const { pending } = useFormStatus();

  return (
    <button className={className} disabled={pending} type="submit">
      {pending ? (
        <LoaderCircle className="buttonSpinner" size={14} aria-hidden="true" />
      ) : (
        children
      )}
      {label}
    </button>
  );
}

function handleDragOver(
  event: DragEvent<HTMLElement>,
  allowed: boolean,
  onAllowed: () => void
): void {
  onAllowed();

  if (!allowed) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
}

function kindLabel(
  kindOptions: readonly OrgUnitKindOption[],
  kind: OrgUnitKind
): string {
  return kindOptions.find((option) => option.id === kind)?.label ?? kind;
}

function formatCount(template: string, count: number): string {
  return template.replace("{count}", String(count));
}
