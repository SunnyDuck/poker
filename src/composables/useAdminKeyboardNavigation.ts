const ADMIN_FIELD_SELECTOR = [
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([disabled]):not([readonly])',
  "select:not([disabled])",
  "textarea:not([disabled]):not([readonly])",
].join(",");

const ENTER_FIELD_SELECTOR =
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([disabled]):not([readonly])';

type ArrowDirection = "up" | "right" | "down" | "left";

const DIRECTIONS: Record<ArrowDirection, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

const getAdminFields = (container: HTMLElement): HTMLElement[] =>
  Array.from(
    container.querySelectorAll<HTMLElement>(ADMIN_FIELD_SELECTOR),
  ).filter((field) => field.getClientRects().length > 0);

const focusField = (field: HTMLElement | undefined): void => {
  if (!field) return;

  field.focus();
  field.scrollIntoView({ block: "nearest", inline: "nearest" });
};

const moveToAdjacentField = (
  container: HTMLElement,
  currentField: HTMLElement,
  direction: ArrowDirection,
): void => {
  const directionVector = DIRECTIONS[direction];
  const currentRect = currentField.getBoundingClientRect();
  const currentCenter = {
    x: currentRect.left + currentRect.width / 2,
    y: currentRect.top + currentRect.height / 2,
  };

  const candidates = getAdminFields(container)
    .filter((field) => field !== currentField)
    .map((field) => {
      const rect = field.getBoundingClientRect();
      const deltaX = rect.left + rect.width / 2 - currentCenter.x;
      const deltaY = rect.top + rect.height / 2 - currentCenter.y;
      const primary = deltaX * directionVector.x + deltaY * directionVector.y;
      const secondary = Math.abs(
        deltaX * directionVector.y - deltaY * directionVector.x,
      );

      return { field, primary, secondary };
    })
    .filter(({ primary }) => primary > 1)
    .sort(
      (left, right) =>
        left.primary +
        left.secondary * 1.5 -
        (right.primary + right.secondary * 1.5),
    );

  focusField(candidates[0]?.field);
};

export const useAdminKeyboardNavigation = () => {
  const handleAdminKeydown = (event: KeyboardEvent): void => {
    const main = document.getElementById("admin-main");
    const target = event.target;

    if (
      !main ||
      !(target instanceof HTMLElement) ||
      !main.contains(target) ||
      event.isComposing
    ) {
      return;
    }

    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      target.matches(ENTER_FIELD_SELECTOR) &&
      !target.closest("[data-enter-player-action]") &&
      !target.closest("[data-enter-submit]")
    ) {
      const fields = getAdminFields(main);
      const currentIndex = fields.indexOf(target);
      const nextField = fields[currentIndex + 1];

      if (nextField) {
        event.preventDefault();
        focusField(nextField);
      }

      return;
    }

    const directionByKey: Record<string, ArrowDirection> = {
      ArrowUp: "up",
      ArrowRight: "right",
      ArrowDown: "down",
      ArrowLeft: "left",
    };
    const direction = directionByKey[event.key];

    if (
      !direction ||
      !event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !target.matches(ADMIN_FIELD_SELECTOR)
    ) {
      return;
    }

    event.preventDefault();
    moveToAdjacentField(main, target, direction);
  };

  return { handleAdminKeydown };
};
