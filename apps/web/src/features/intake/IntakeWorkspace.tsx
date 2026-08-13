import {
  ClipboardPenLine,
  FileSpreadsheet,
  ListPlus,
  Search,
  ShieldCheck,
  type LucideIcon
} from "lucide-react";
import {
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode
} from "react";
import "./IntakeWorkspace.css";

export const intakeMethods = ["search", "manual", "psa", "bulk", "csv"] as const;

export type IntakeMethod = (typeof intakeMethods)[number];

export type IntakeWorkflowContext = {
  canEdit: boolean;
  method: IntakeMethod;
};

export type IntakeWorkflowSlot =
  | ReactNode
  | ((context: IntakeWorkflowContext) => ReactNode);

export type IntakeWorkflowSlots = Partial<Record<IntakeMethod, IntakeWorkflowSlot>>;

export type IntakeWorkspaceProps = {
  activeMethod: IntakeMethod | null;
  canEdit: boolean;
  onMethodSelect: (method: IntakeMethod) => void;
  workflows: IntakeWorkflowSlots;
  className?: string;
  readOnlyMessage?: string;
};

type IntakeMethodDefinition = {
  description: string;
  icon: LucideIcon;
  label: string;
  shortLabel: string;
};

const methodDefinitions: Record<IntakeMethod, IntakeMethodDefinition> = {
  search: {
    description: "Find English or Japanese card metadata and review the match before adding it.",
    icon: Search,
    label: "Search cards",
    shortLabel: "Search"
  },
  manual: {
    description: "Enter collection details directly when a lookup is unavailable or unnecessary.",
    icon: ClipboardPenLine,
    label: "Manual entry",
    shortLabel: "Manual"
  },
  psa: {
    description: "Load PSA label details from a certificate number before saving a graded card.",
    icon: ShieldCheck,
    label: "PSA certificate",
    shortLabel: "PSA cert"
  },
  bulk: {
    description: "Paste or upload a list, resolve each row, and add several cards in one pass.",
    icon: ListPlus,
    label: "Bulk list",
    shortLabel: "Bulk"
  },
  csv: {
    description: "Preview and validate structured inventory rows before importing the file.",
    icon: FileSpreadsheet,
    label: "CSV import",
    shortLabel: "CSV"
  }
};

export function IntakeWorkspace({
  activeMethod,
  canEdit,
  className,
  onMethodSelect,
  readOnlyMessage = "Viewer access is read-only. Ask a collection editor, admin, or owner to add cards.",
  workflows
}: IntakeWorkspaceProps) {
  const generatedId = useId();
  const tabIdPrefix = `intake-${generatedId.replace(/:/g, "")}`;
  const tabRefs = useRef<Partial<Record<IntakeMethod, HTMLButtonElement | null>>>({});
  const activeDefinition = activeMethod ? methodDefinitions[activeMethod] : null;

  function selectAndFocus(method: IntakeMethod) {
    onMethodSelect(method);
    tabRefs.current[method]?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, method: IntakeMethod) {
    const currentIndex = intakeMethods.indexOf(method);
    let nextMethod: IntakeMethod | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextMethod = intakeMethods[(currentIndex + 1) % intakeMethods.length];
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextMethod = intakeMethods[
        (currentIndex - 1 + intakeMethods.length) % intakeMethods.length
      ];
    } else if (event.key === "Home") {
      nextMethod = intakeMethods[0];
    } else if (event.key === "End") {
      nextMethod = intakeMethods[intakeMethods.length - 1];
    }

    if (nextMethod) {
      event.preventDefault();
      selectAndFocus(nextMethod);
    }
  }

  return (
    <section
      aria-labelledby={`${tabIdPrefix}-heading`}
      className={["intake-workspace", className].filter(Boolean).join(" ")}
    >
      <div className="intake-workspace-header">
        <div>
          <p className="eyebrow">Card intake</p>
          <h3 id={`${tabIdPrefix}-heading`}>Choose an intake method</h3>
          <p>
            Choose the input route that matches your source. Each method keeps its own proven
            lookup, review, and validation flow.
          </p>
        </div>
        <span className={`intake-access-badge ${canEdit ? "can-edit" : "read-only"}`}>
          {canEdit ? "Editor access" : "Read-only"}
        </span>
      </div>

      <div aria-label="Add card method" className="intake-method-tabs" role="tablist">
        {intakeMethods.map((method, index) => {
          const definition = methodDefinitions[method];
          const Icon = definition.icon;
          const isActive = activeMethod === method;

          return (
            <button
              aria-controls={`${tabIdPrefix}-${method}-panel`}
              aria-selected={isActive}
              className={isActive ? "active" : ""}
              id={`${tabIdPrefix}-${method}-tab`}
              key={method}
              onClick={() => onMethodSelect(method)}
              onKeyDown={(event) => handleTabKeyDown(event, method)}
              ref={(element) => {
                tabRefs.current[method] = element;
              }}
              role="tab"
              tabIndex={isActive || (activeMethod === null && index === 0) ? 0 : -1}
              type="button"
            >
              <Icon aria-hidden="true" size={18} />
              <span>
                <strong>{definition.shortLabel}</strong>
                <small>{definition.label}</small>
              </span>
            </button>
          );
        })}
      </div>

      {activeMethod && activeDefinition ? (
        <div
          aria-labelledby={`${tabIdPrefix}-${activeMethod}-tab`}
          className="intake-method-panel"
          id={`${tabIdPrefix}-${activeMethod}-panel`}
          role="tabpanel"
          tabIndex={0}
        >
          <IntakeMethodHeader definition={activeDefinition} />
          {canEdit ? (
            <div className="intake-workflow-slot">
              {renderWorkflowSlot(workflows[activeMethod], {
                canEdit,
                method: activeMethod
              })}
            </div>
          ) : (
            <div className="intake-permission-state" role="note">
              <ShieldCheck aria-hidden="true" size={24} />
              <div>
                <strong>Adding cards is unavailable</strong>
                <p>{readOnlyMessage}</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="intake-introduction">
          <div className="intake-introduction-copy">
            <ListPlus aria-hidden="true" size={28} />
            <div>
              <strong>Choose an intake method</strong>
              <p>
                Search for individual cards, enter one manually, use a PSA certificate, paste a
                bulk list, or validate a CSV file.
              </p>
            </div>
          </div>
          <div className="intake-method-summary" aria-label="Available intake methods">
            {intakeMethods.map((method) => {
              const definition = methodDefinitions[method];
              const Icon = definition.icon;

              return (
                <button
                  disabled={!canEdit}
                  key={method}
                  onClick={() => onMethodSelect(method)}
                  type="button"
                >
                  <Icon aria-hidden="true" size={18} />
                  <span>
                    <strong>{definition.label}</strong>
                    <small>{definition.description}</small>
                  </span>
                </button>
              );
            })}
          </div>
          {!canEdit ? <p className="intake-read-only-note">{readOnlyMessage}</p> : null}
        </div>
      )}
    </section>
  );
}

function IntakeMethodHeader({ definition }: { definition: IntakeMethodDefinition }) {
  const Icon = definition.icon;

  return (
    <div className="intake-method-header">
      <span className="intake-method-icon" aria-hidden="true">
        <Icon size={19} />
      </span>
      <div>
        <h3>{definition.label}</h3>
        <p>{definition.description}</p>
      </div>
    </div>
  );
}

function renderWorkflowSlot(
  slot: IntakeWorkflowSlot | undefined,
  context: IntakeWorkflowContext
) {
  if (!slot) {
    return (
      <div className="intake-empty-workflow" role="status">
        <FileSpreadsheet aria-hidden="true" size={24} />
        <div>
          <strong>This workflow is not connected yet</strong>
          <p>Connect the existing {methodDefinitions[context.method].label.toLowerCase()} panel here.</p>
        </div>
      </div>
    );
  }

  return typeof slot === "function" ? slot(context) : slot;
}
