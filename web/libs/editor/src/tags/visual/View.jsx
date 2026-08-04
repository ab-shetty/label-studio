import { observer } from "mobx-react";
import { types } from "mobx-state-tree";
import { useCallback, useEffect, useRef, useState } from "react";

import Registry from "../../core/Registry";
import Tree from "../../core/Tree";
import Types from "../../core/Types";
import VisibilityMixin from "../../mixins/Visibility";
import { AnnotationMixin } from "../../mixins/AnnotationMixin";
import "./View.prefix.css";

/**
 * The `View` element is used to configure the display of blocks, similar to the div tag in HTML.
 * @example
 * <!-- Create two cards that flex to take up 50% of the screen width on the labeling interface -->
 * <View style="display: flex;">
 *   <!-- Left side -->
 *   <View style="flex: 50%">
 *     <Header value="Facts:" />
 *     <Text name="text" value="$fact" />
 *   </View>
 *   <!-- Right side -->
 *   <View style="flex: 50%; margin-left: 1em">
 *     <Header value="Enter your question:" />
 *     <TextArea name="question" />
 *   </View>
 * </View>
 * @example
 * <View>
 *   <Text name="text" value="$text"/>
 *   <Choices name="sentiment" toName="text">
 *     <Choice value="Positive"/>
 *     <Choice value="Negative"/>
 *     <Choice value="Neutral"/>
 *   </Choices>
 *   <!-- Shown only when Positive or Negative is selected -->
 *   <View visibleWhen="choice-selected" whenTagName="sentiment"
 *         whenChoiceValue="Positive,Negative">
 *     <Header value="Why?"/>
 *     <TextArea name="why_positive" toName="text"/>
 *   </View>
 * </View>
 * @example
 * <View>
 *   <Labels name="label" toName="text">
 *     <Label value="PER" background="red"/>
 *     <Label value="ORG" background="darkorange"/>
 *     <Label value="LOC" background="orange"/>
 *     <Label value="MISC" background="green"/>
 *   </Labels>
 *   <Text name="text" value="$text"/>
 *   <!-- Shown only when region PER or ORG is selected -->
 *   <View visibleWhen="region-selected" whenLabelValue="PER,ORG">
 *     <Header value="yoho"/>
 *   </View>
 * </View>
 * @name View
 * @meta_title View Tag for Defining How Blocks are Displayed
 * @meta_description Customize how blocks are displayed on the labeling interface in Label Studio for machine learning and data science projects.
 * @param {block|inline} display
 * @param {string} [style] CSS style string
 * @param {string} [className] - Class name of the CSS style to apply. Use with the Style tag
 * @param {string} [idAttr] - Unique ID attribute to use in CSS
 * @param {boolean} [resizable=false] Put a draggable divider between this View's first child and the rest, letting the user trade width between the two (e.g. image vs. label list). The split is remembered per View id.
 * @param {number} [defaultSplit=45] Use with `resizable`. Starting width of the first child, as a percentage.
 * @param {number} [minSplit=20] Use with `resizable`. Smallest width the first child can be dragged to, as a percentage.
 * @param {number} [maxSplit=80] Use with `resizable`. Largest width the first child can be dragged to, as a percentage.
 * @param {region-selected|choice-selected|no-region-selected|choice-unselected} [visibleWhen] Control visibility of the content. Can also be used with the `when*` parameters below to narrow visibility
 * @param {string} [whenTagName] Use with `visibleWhen`. Narrow down visibility by tag name. For regions, use the name of the object tag, for choices, use the name of the `choices` tag
 * @param {string} [whenLabelValue] Use with `visibleWhen="region-selected"`. Narrow down visibility by label value. Multiple values can be separated with commas
 * @param {string} [whenChoiceValue] Use with `visibleWhen` (`"choice-selected"` or `"choice-unselected"`) and `whenTagName`, both are required. Narrow down visibility by choice value. Multiple values can be separated with commas
 */
const TagAttrs = types.model({
  classname: types.optional(types.string, ""),
  display: types.optional(types.string, "block"),
  style: types.maybeNull(types.string),
  idattr: types.optional(types.string, ""),
  resizable: types.optional(types.boolean, false),
  defaultsplit: types.optional(types.string, "45"),
  minsplit: types.optional(types.string, "20"),
  maxsplit: types.optional(types.string, "80"),
});

const Model = types
  .model({
    id: types.identifier,
    type: "view",
    children: Types.unionArray([
      "view",
      "header",
      "markdown",
      "labels",
      "label",
      "table",
      "taxonomy",
      "choices",
      "choice",
      "collapse",
      "datetime",
      "number",
      "rating",
      "ranker",
      "rectangle",
      "ellipse",
      "polygon",
      "keypoint",
      "brush",
      "bitmask",
      "magicwand",
      "rectanglelabels",
      "ellipselabels",
      "polygonlabels",
      "vector",
      "vectorlabels",
      "keypointlabels",
      "brushlabels",
      "hypertextlabels",
      "timeserieslabels",
      "bitmasklabels",
      "text",
      "audio",
      "image",
      "hypertext",
      "richtext",
      "timeseries",
      "audioplus",
      "list",
      "dialog",
      "textarea",
      "pairwise",
      "style",
      "relations",
      "filter",
      "pagedview",
      "paragraphs",
      "paragraphlabels",
      "pdf",
      "video",
      "videorectangle",
      "videovector",
      "videovectorlabels",
      "timelinelabels",
      "custominterface",
      ...Registry.customTags.map((t) => t.tag.toLowerCase()),
    ]),
  })
  .views((self) => ({
    // Indicates that it could exist without information about objects, taskData and regions
    get isIndependent() {
      return true;
    },
  }));

const ViewModel = types.compose(
  "ViewModel",
  TagAttrs,
  Model,
  VisibilityMixin,
  AnnotationMixin,
);

const SPLIT_STORAGE_PREFIX = "ls:view-split:";

/* Each pane its own scroll container, so reaching the bottom of a tall shelf
   photo no longer carries the SKU list off the top of the screen. min-width/
   min-height 0 defeat flex's automatic minimum, which otherwise refuses to
   shrink a pane below its content -- that would both jam the drag and push the
   split past the max-height that makes the scrolling work at all. */
const PANE_STYLE = { minWidth: 0, minHeight: 0, overflow: "auto" };

const clampSplit = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * A stable storage key for a View's split position.
 *
 * Not `item.id`: a View carries no `name`, so Tree.tagIntoObject falls back to
 * `guidGenerator()` and hands it a different id every time the config is parsed
 * — i.e. on every task. Keying storage on that silently resets the split each
 * time you move between tasks. The names of the tags nested inside are declared
 * in the config, so they're the same on every parse and different between
 * configs, which is exactly the identity we want.
 */
const splitStorageKey = (item) => {
  if (item.idattr) return item.idattr;

  const names = [];
  const walk = (node) => {
    for (const child of node.children ?? []) {
      if (child.name) names.push(child.name);
      walk(child);
    }
  };
  walk(item);
  return names.join(",") || "default";
};

/**
 * Splits a View's children into two panes with a draggable divider between the
 * first child and the rest. The width lives in local state (not the MST tree)
 * so dragging doesn't churn the annotation store, and is persisted per View id
 * so it survives moving between tasks and reloading.
 */
const ResizableView = observer(({ item, style }) => {
  const min = Number(item.minsplit) || 20;
  const max = Number(item.maxsplit) || 80;
  const storageKey = `${SPLIT_STORAGE_PREFIX}${splitStorageKey(item)}`;

  const containerRef = useRef(null);
  const [split, setSplit] = useState(() => {
    const stored = Number(localStorage.getItem(storageKey));
    const initial =
      Number.isFinite(stored) && stored > 0
        ? stored
        : Number(item.defaultsplit) || 45;
    return clampSplit(initial, min, max);
  });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return undefined;

    const onMove = (e) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect?.width) return;
      setSplit(
        clampSplit(((e.clientX - rect.left) / rect.width) * 100, min, max),
      );
    };
    const onUp = () => setDragging(false);

    // `capture` so a pane that stops propagation (the image canvas swallows
    // pointer events for its own pan/zoom handling) can't strand a drag.
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    return () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  }, [dragging, min, max]);

  useEffect(() => {
    if (dragging) return;
    localStorage.setItem(storageKey, String(split));
  }, [dragging, split, storageKey]);

  const onKeyDown = useCallback(
    (e) => {
      const step = e.shiftKey ? 10 : 2;
      if (e.key === "ArrowLeft")
        setSplit((s) => clampSplit(s - step, min, max));
      else if (e.key === "ArrowRight")
        setSplit((s) => clampSplit(s + step, min, max));
      else if (e.key === "Home")
        setSplit(clampSplit(Number(item.defaultsplit) || 45, min, max));
      else return;
      e.preventDefault();
    },
    [min, max, item.defaultsplit],
  );

  const children = Tree.renderChildren(item, item.annotation) ?? [];
  const [first, ...rest] = children;

  return (
    <div
      ref={containerRef}
      id={item.idattr}
      className={`${item.classname} lsf-view-split`}
      // Layout is INLINE, not in View.prefix.css, and deliberately so: that
      // stylesheet is a lazy webpack chunk the app requests from
      // /label-studio-frontend/, which nginx does not serve (it only aliases
      // /react-app/), so it 404s and none of its rules ever apply. The flex
      // sizing below always worked for exactly this reason. Until the chunk is
      // reachable, anything the split NEEDS in order to function has to live
      // here. See deploy/default.conf.
      style={{
        ...style,
        display: "flex",
        alignItems: "stretch",
        // Panes scroll independently only if the split's own height is bounded:
        // `overflow: auto` on a pane free to grow just makes the pane taller.
        // Tunable at runtime without a rebuild.
        maxHeight: "var(--view-split-height, calc(100vh - 13rem))",
        overflow: "hidden",
      }}
      data-dragging={dragging || undefined}
    >
      <div
        className="lsf-view-split__pane"
        style={{ flex: `0 0 ${split}%`, ...PANE_STYLE }}
      >
        {first}
      </div>
      <div
        className="lsf-view-split__handle"
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(split)}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-label="Resize panes"
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onKeyDown={onKeyDown}
      />
      <div
        className="lsf-view-split__pane"
        style={{ flex: "1 1 auto", ...PANE_STYLE }}
      >
        {rest}
      </div>
    </div>
  );
});

const HtxView = observer(({ item }) => {
  let style = {};

  if (item.display === "inline") {
    style = { display: "inline-block", marginRight: "15px" };
  }

  if (item.style) {
    style = Tree.cssConverter(item.style);
  }

  if (item.isVisible === false) {
    style.display = "none";
  }

  // A divider only means something with two sides to trade width between.
  if (
    item.resizable &&
    item.isVisible !== false &&
    (item.children?.length ?? 0) > 1
  ) {
    return <ResizableView item={item} style={style} />;
  }

  return (
    <div id={item.idattr} className={item.classname} style={style}>
      {Tree.renderChildren(item, item.annotation)}
    </div>
  );
});

Registry.addTag("view", ViewModel, HtxView);

export { HtxView, ViewModel };
