"use client";

import {
  ArrowRight,
  ChartColumnIncreasing,
  Inbox,
  SquareUser,
  UserCheck,
  type LucideIcon
} from "lucide-react";
import Image from "next/image";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement
} from "react";

export type ProductWorkflowContent = {
  kicker: string;
  title: string;
  lead: string;
  imageAlt: string;
  steps: Array<{
    title: string;
    description: string;
    icon: string;
  }>;
};

type WorkflowIconName = "inbox" | "user" | "handoff" | "chart";

const workflowIcons: Record<WorkflowIconName, LucideIcon> = {
  inbox: Inbox,
  user: SquareUser,
  handoff: UserCheck,
  chart: ChartColumnIncreasing
};

const autoAdvanceDelay = 6500;

function interpolateProduct(value: string, productName: string): string {
  return value.replaceAll("{product}", productName);
}

export function ProductWorkflow({
  content,
  productName,
  lightImage,
  darkImage
}: {
  content: ProductWorkflowContent;
  productName: string;
  lightImage: string;
  darkImage: string;
}): ReactElement {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const tabsId = useId();
  const panelId = `${tabsId}-panel`;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeStep = content.steps[activeIndex] ?? content.steps[0];

  useEffect(() => {
    if (isPaused || content.steps.length < 2) {
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    if (reducedMotion.matches) {
      return;
    }

    const timer = window.setTimeout(() => {
      setActiveIndex((current) => (current + 1) % content.steps.length);
    }, autoAdvanceDelay);

    return () => window.clearTimeout(timer);
  }, [activeIndex, content.steps.length, isPaused]);

  useEffect(() => {
    const activeTab = tabRefs.current[activeIndex];
    const tabList = activeTab?.parentElement;

    if (!activeTab || !tabList || tabList.scrollWidth <= tabList.clientWidth) {
      return;
    }

    tabList.scrollTo({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      left:
        activeTab.offsetLeft - (tabList.clientWidth - activeTab.clientWidth) / 2
    });
  }, [activeIndex]);

  function selectStep(index: number): void {
    setActiveIndex(index);
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ): void {
    let nextIndex: number | undefined;

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % content.steps.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + content.steps.length) % content.steps.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = content.steps.length - 1;
    }

    if (nextIndex === undefined) {
      return;
    }

    event.preventDefault();
    selectStep(nextIndex);
    tabRefs.current[nextIndex]?.focus();
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>): void {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsPaused(false);
    }
  }

  return (
    <section className="product-workflow" id="product">
      <header className="product-workflow__heading">
        <p className="section-kicker">{content.kicker}</p>
        <h2>{content.title}</h2>
        <p>{interpolateProduct(content.lead, productName)}</p>
      </header>

      <div
        className={`product-workflow__stage${isPaused ? " is-paused" : ""}`}
        onBlur={handleBlur}
        onFocusCapture={() => setIsPaused(true)}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        <div className="product-workflow__navigator">
          <div
            aria-label={content.title}
            className="workflow-steps"
            role="tablist"
          >
            {content.steps.map((step, index) => {
              const Icon =
                workflowIcons[step.icon as WorkflowIconName] ?? Inbox;
              const isActive = index === activeIndex;
              const tabId = `${tabsId}-tab-${index}`;

              return (
                <button
                  aria-controls={panelId}
                  aria-selected={isActive}
                  className={`workflow-step${isActive ? " is-active" : ""}`}
                  id={tabId}
                  key={step.title}
                  onClick={() => selectStep(index)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                  ref={(node) => {
                    tabRefs.current[index] = node;
                  }}
                  role="tab"
                  tabIndex={isActive ? 0 : -1}
                  type="button"
                >
                  <span className="workflow-step__index" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="workflow-step__icon" aria-hidden="true">
                    <Icon size={25} strokeWidth={2} />
                  </span>
                  <span className="workflow-step__title">{step.title}</span>
                  <span className="workflow-step__arrow" aria-hidden="true">
                    <ArrowRight size={19} strokeWidth={2} />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="workflow-step__detail">
            <span aria-hidden="true">
              {String(activeIndex + 1).padStart(2, "0")}
            </span>
            <p>{activeStep.description}</p>
          </div>

          <div className="workflow-progress" aria-hidden="true">
            <span>{String(activeIndex + 1).padStart(2, "0")}</span>
            <i>
              <b key={activeIndex} />
            </i>
            <span>{String(content.steps.length).padStart(2, "0")}</span>
          </div>
        </div>

        <div
          aria-labelledby={`${tabsId}-tab-${activeIndex}`}
          className="product-workflow__visual"
          id={panelId}
          role="tabpanel"
        >
          <div className="product-workflow__visual-frame">
            <Image
              className="product-workflow__image product-workflow__image--light"
              src={lightImage}
              alt={interpolateProduct(content.imageAlt, productName)}
              width={1536}
              height={1024}
              loading="eager"
            />
            <Image
              className="product-workflow__image product-workflow__image--dark"
              src={darkImage}
              alt={interpolateProduct(content.imageAlt, productName)}
              width={1536}
              height={1024}
              loading="eager"
            />
            <span
              className="product-workflow__focus"
              data-focus={activeIndex}
              aria-hidden="true"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
