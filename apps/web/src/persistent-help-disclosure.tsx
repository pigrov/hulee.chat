"use client";

import { useEffect, useState, type ReactNode } from "react";

export type PersistentHelpDisclosureContent = {
  readonly examples?: readonly string[];
  readonly paragraphs: readonly string[];
  readonly title: string;
};

export type PersistentHelpDisclosureLabels = {
  readonly examples: string;
  readonly hide: string;
  readonly show: string;
};

type StoredHelpState = "closed" | "open";

export function PersistentHelpDisclosure({
  content,
  id,
  labels,
  storageKey
}: {
  readonly content: PersistentHelpDisclosureContent;
  readonly id: string;
  readonly labels: PersistentHelpDisclosureLabels;
  readonly storageKey: string;
}): ReactNode {
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    const storedState = readStoredHelpState(storageKey);

    if (storedState !== undefined) {
      setIsOpen(storedState === "open");
    }
  }, [storageKey]);

  function setOpen(nextIsOpen: boolean): void {
    setIsOpen(nextIsOpen);
    writeStoredHelpState(storageKey, nextIsOpen ? "open" : "closed");
  }

  return (
    <div className="helpDisclosure">
      <button
        aria-controls={id}
        aria-expanded={isOpen}
        aria-label={isOpen ? labels.hide : labels.show}
        className="helpToggleButton"
        title={isOpen ? labels.hide : labels.show}
        type="button"
        onClick={() => setOpen(!isOpen)}
      >
        ?
      </button>

      {isOpen ? (
        <div
          aria-label={content.title}
          className="helpDisclosurePanel"
          id={id}
          role="region"
        >
          <div className="helpDisclosureBody">
            <h3 className="helpDisclosureTitle">{content.title}</h3>
            {content.paragraphs.map((paragraph, index) => (
              <p className="metaText" key={`${index}:${paragraph}`}>
                {paragraph}
              </p>
            ))}
          </div>

          {content.examples && content.examples.length > 0 ? (
            <div className="helpDisclosureExamples">
              <p className="detailLabel">{labels.examples}</p>
              <ul className="helpDisclosureList">
                {content.examples.map((example, index) => (
                  <li key={`${index}:${example}`}>{example}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <button
            className="secondaryButton helpDisclosureClose"
            type="button"
            onClick={() => setOpen(false)}
          >
            {labels.hide}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function readStoredHelpState(storageKey: string): StoredHelpState | undefined {
  try {
    const value = window.localStorage.getItem(storageKey);

    return value === "closed" || value === "open" ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredHelpState(
  storageKey: string,
  state: StoredHelpState
): void {
  try {
    window.localStorage.setItem(storageKey, state);
  } catch {
    // Ignore storage failures: the disclosure should remain usable.
  }
}
