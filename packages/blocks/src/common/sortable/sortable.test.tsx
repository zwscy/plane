/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sortable } from "./sortable";

type TDragData = Record<string | symbol, unknown>;
type TMonitorArgs = {
  canMonitor: (args: { source: { data: TDragData } }) => boolean;
  onDrop: (args: {
    source: { data: TDragData };
    location: { current: { dropTargets: { data: TDragData }[] } };
  }) => void;
};

// Records what `Sortable` and its `Draggable`s register on the element adapter, so the tests can drive the monitor.
type TDraggableArgs = {
  element: HTMLElement;
  dragHandle?: HTMLElement;
  onGenerateDragPreview?: (args: { nativeSetDragImage: (element: HTMLElement, x: number, y: number) => void }) => void;
};
type TPreviewArgs = {
  nativeSetDragImage: unknown;
  render: (args: { container: HTMLElement }) => void | (() => void);
};
const adapter = vi.hoisted(() => ({
  monitors: [] as TMonitorArgs[],
  draggables: [] as TDraggableArgs[],
  draggableCount: 0,
  previews: [] as TPreviewArgs[],
}));

vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  monitorForElements: (args: TMonitorArgs) => {
    adapter.monitors.push(args);
    return () => undefined;
  },
  draggable: (args: TDraggableArgs) => {
    adapter.draggables.push(args);
    adapter.draggableCount += 1;
    return () => undefined;
  },
  dropTargetForElements: () => () => undefined,
}));

vi.mock("@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview", () => ({
  setCustomNativeDragPreview: (args: TPreviewArgs) => adapter.previews.push(args),
}));

type TItem = { key: string; label: string };

const items: TItem[] = [
  { key: "a", label: "A" },
  { key: "b", label: "B" },
  { key: "c", label: "C" },
];

const renderList = (onChange = vi.fn()) => {
  render(
    <Sortable
      data={items}
      id="list"
      keyExtractor={(item) => item.key}
      onChange={onChange}
      render={(item) => item.label}
    />
  );
  const monitor = adapter.monitors.at(-1);
  if (!monitor) throw new Error("Sortable registered no drop monitor");
  return { monitor, onChange };
};

describe("Sortable", () => {
  beforeEach(() => {
    adapter.monitors = [];
    adapter.draggables = [];
    adapter.draggableCount = 0;
    adapter.previews = [];
  });

  it("registers one draggable per row and a drop monitor", () => {
    renderList();
    expect(adapter.draggableCount).toBe(items.length);
    expect(adapter.monitors.length).toBeGreaterThan(0);
  });

  it("keeps default native previews and whole-row dragging for existing callers", () => {
    renderList();
    expect(adapter.draggables[0].dragHandle).toBeUndefined();
    expect(adapter.draggables[0].onGenerateDragPreview).toBeUndefined();
  });

  it("binds an opted-in handle and snapshots only the field preview at the source width", () => {
    render(
      <section>
        <h2>Column settings</h2>
        <input placeholder="Search fields" />
        <Sortable
          data={items}
          keyExtractor={(item) => item.key}
          onChange={vi.fn()}
          dragHandleSelector="[data-field-drag-handle]"
          renderDragPreview={(item) => <div style={{ height: 36 }}>{item.label}</div>}
          render={(item) => (
            <div>
              <button type="button" data-field-drag-handle aria-label={`Drag ${item.label}`} />
              <span>{item.label}</span>
              <button type="button">Move up</button>
            </div>
          )}
        />
      </section>
    );
    const registration = adapter.draggables[0];
    expect(registration.dragHandle).toBe(screen.getByRole("button", { name: "Drag A" }));
    expect(registration.onGenerateDragPreview).toBeTypeOf("function");
    vi.spyOn(registration.element, "getBoundingClientRect").mockReturnValue({ width: 320, height: 40 } as DOMRect);
    const nativeSetDragImage = vi.fn();
    registration.onGenerateDragPreview?.({ nativeSetDragImage });
    expect(adapter.previews).toHaveLength(1);
    expect(adapter.previews[0].nativeSetDragImage).toBe(nativeSetDragImage);
    const container = document.createElement("div");
    document.body.append(container);
    let cleanup: void | (() => void) = undefined;
    act(() => {
      cleanup = adapter.previews[0].render({ container });
    });
    try {
      expect(container.textContent).toBe("A");
      expect((container.firstElementChild as HTMLElement).style.width).toBe("320px");
      expect(container.querySelector<HTMLElement>("[style*=height]")?.style.height).toBe("36px");
      expect(container.querySelector("input,button")).toBeNull();
      expect(container.textContent).not.toContain("Column settings");
      expect(container.textContent).not.toContain("Search fields");
      expect(container.textContent).not.toContain("Move up");
    } finally {
      act(() => cleanup?.());
      container.remove();
    }
  });

  it("only monitors drags that started in its own list", () => {
    const { monitor } = renderList();
    expect(monitor.canMonitor({ source: { data: { ...items[0], __uuid__: "list" } } })).toBe(true);
    expect(monitor.canMonitor({ source: { data: { ...items[0], __uuid__: "other-list" } } })).toBe(false);
    expect(monitor.canMonitor({ source: { data: { isExternal: true } } })).toBe(false);
  });

  it("moves the dragged row to the drop edge and reports the moved item", () => {
    const { monitor, onChange } = renderList();
    monitor.onDrop({
      source: { data: { ...items[0], __uuid__: "list" } },
      location: {
        current: { dropTargets: [{ data: { ...items[2], __uuid__: "list", [Symbol("closestEdge")]: "bottom" } }] },
      },
    });
    expect(onChange).toHaveBeenCalledWith([items[1], items[2], items[0]], items[0]);
  });

  it("does nothing when the row is dropped outside every target", () => {
    const { monitor, onChange } = renderList();
    monitor.onDrop({
      source: { data: { ...items[0], __uuid__: "list" } },
      location: { current: { dropTargets: [] } },
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps its registrations across re-renders with fresh inline callbacks", () => {
    const renderWith = (onChange: (data: TItem[], movedItem?: TItem) => void) => (
      <Sortable
        data={items}
        id="list"
        keyExtractor={(item) => item.key}
        onChange={onChange}
        onExternalAdd={() => undefined}
        render={(item) => item.label}
      />
    );
    const firstOnChange = vi.fn();
    const { rerender } = render(renderWith(firstOnChange));
    const monitorCount = adapter.monitors.length;

    const latestOnChange = vi.fn();
    rerender(renderWith(latestOnChange));

    expect(adapter.draggableCount).toBe(items.length);
    expect(adapter.monitors.length).toBe(monitorCount);

    // The monitor registered on the first render still reaches the latest `onChange`.
    adapter.monitors.at(-1)?.onDrop({
      source: { data: { ...items[0], __uuid__: "list" } },
      location: {
        current: { dropTargets: [{ data: { ...items[1], __uuid__: "list", [Symbol("closestEdge")]: "bottom" } }] },
      },
    });
    expect(firstOnChange).not.toHaveBeenCalled();
    expect(latestOnChange).toHaveBeenCalledWith([items[1], items[0], items[2]], items[0]);
  });
});
