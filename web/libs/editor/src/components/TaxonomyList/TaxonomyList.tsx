import { type ChangeEvent, useCallback, useMemo, useState } from "react";

import styles from "./TaxonomyList.module.css";
import type { TaxonomyItem, TaxonomyPath } from "../NewTaxonomy/NewTaxonomy";

type TaxonomyListOptions = {
  leafsOnly?: boolean;
  showFullPath?: boolean;
  pathSeparator: string;
  maxUsages?: number;
  maxWidth?: number;
  minWidth?: number;
  placeholder?: string;
  canRemoveItems?: boolean;
};

type TaxonomyListProps = {
  items: TaxonomyItem[];
  /** Currently selected paths as arrays of string values. Same shape as `self.selected`. */
  selected: TaxonomyPath[];
  /** Most-recently-used path keys (joined by pathSeparator), newest first. */
  mruPaths: string[];
  /** Called with the full next selected set when the user toggles an item. */
  onChange: (node: null, selected: TaxonomyPath[]) => void;
  /** Called with the path key of the item the user just clicked, to bump it in MRU. */
  onUse: (pathKey: string) => void;
  /**
   * Whether there is currently a region/item the selection can apply to.
   * In perRegion mode this is false when no region is highlighted; clicks are then
   * disabled and a hint is shown instead of committing a no-op.
   */
  hasSelectableRegion: boolean;
  options: TaxonomyListOptions;
  isEditable?: boolean;
};

type LeafItem = {
  label: string;
  path: TaxonomyPath;
  pathKey: string;
  categoryPath: string[]; // parents, excluding the leaf itself
  color?: string;
  hint?: string;
  /** Lowercased haystack for search. */
  haystack: string;
};

/** Walk the taxonomy tree and return only leaf nodes in DFS order. */
function getLeafItems(items: TaxonomyItem[], pathSeparator: string): LeafItem[] {
  const out: LeafItem[] = [];
  const walk = (nodes: TaxonomyItem[]) => {
    for (const node of nodes) {
      if (node.children && node.children.length > 0) {
        walk(node.children);
      } else {
        const path = node.path;
        const categoryPath = path.slice(0, -1);
        const pathKey = path.join(pathSeparator);
        const haystack = `${node.label} ${categoryPath.join(" ")}`.toLowerCase();
        out.push({
          label: node.label,
          path,
          pathKey,
          categoryPath,
          color: node.color,
          hint: node.hint,
          haystack,
        });
      }
    }
  };
  walk(items);
  return out;
}

/** 0 = startsWith match, 1 = word-boundary contains match, 2 = plain contains, 99 = no match */
function searchRank(leaf: LeafItem, query: string): number {
  if (!query) return 0;
  const label = leaf.label.toLowerCase();
  if (label.startsWith(query)) return 0;
  // word-boundary: the query appears after a space/punctuation in the label
  if (new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(label)) return 1;
  if (leaf.haystack.includes(query)) return 2;
  return 99;
}

const TaxonomyList = ({
  items,
  selected,
  mruPaths,
  onChange,
  onUse,
  hasSelectableRegion,
  options,
  isEditable = true,
}: TaxonomyListProps) => {
  const separator = options.pathSeparator;
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim().toLowerCase();

  const leaves = useMemo(() => getLeafItems(items, separator), [items, separator]);

  const selectedKeySet = useMemo(() => {
    const set = new Set<string>();
    for (const path of selected) set.add(path.join(separator));
    return set;
  }, [selected, separator]);

  const mruRank = useMemo(() => {
    const rank = new Map<string, number>();
    mruPaths.forEach((key, i) => rank.set(key, i));
    return rank;
  }, [mruPaths]);

  const displayed = useMemo(() => {
    const matched: Array<{ leaf: LeafItem; rank: number; mru: number; idx: number }> = [];
    leaves.forEach((leaf, idx) => {
      const rank = searchRank(leaf, trimmedQuery);
      if (rank === 99) return;
      const mru = mruRank.has(leaf.pathKey) ? (mruRank.get(leaf.pathKey) as number) : Number.POSITIVE_INFINITY;
      matched.push({ leaf, rank, mru, idx });
    });
    matched.sort((a, b) => {
      // primary: search rank (only differs when searching)
      if (a.rank !== b.rank) return a.rank - b.rank;
      // secondary: MRU (lower = more recent)
      if (a.mru !== b.mru) return a.mru - b.mru;
      // tertiary: original config order (stable)
      return a.idx - b.idx;
    });
    return matched.map((m) => m.leaf);
  }, [leaves, trimmedQuery, mruRank]);

  const maxUsages = options.maxUsages ? Number(options.maxUsages) : undefined;
  // maxUsages=1 switches the tag into "single selection" mode: clicking a new
  // chip replaces the current selection instead of being rejected for being
  // over the cap. Any other finite cap keeps the strict append-until-full
  // behavior (clicks beyond the cap are no-ops).
  const singleSelectMode = maxUsages === 1;
  const maxUsagesReached = Boolean(maxUsages && !singleSelectMode && selected.length >= maxUsages);

  const handleToggle = useCallback(
    (leaf: LeafItem) => {
      if (!isEditable) return;
      if (!hasSelectableRegion) return;
      const isSelected = selectedKeySet.has(leaf.pathKey);
      let nextPaths: TaxonomyPath[];
      if (isSelected) {
        if (options.canRemoveItems === false) return;
        nextPaths = selected.filter((p) => p.join(separator) !== leaf.pathKey);
      } else if (singleSelectMode) {
        // Replace whatever was there with just this one path.
        nextPaths = [leaf.path];
      } else {
        if (maxUsagesReached) return;
        nextPaths = [...selected, leaf.path];
      }
      onChange(null, nextPaths);
      onUse(leaf.pathKey);
    },
    [
      isEditable,
      hasSelectableRegion,
      selectedKeySet,
      selected,
      separator,
      options.canRemoveItems,
      singleSelectMode,
      maxUsagesReached,
      onChange,
      onUse,
    ],
  );

  const handleQueryChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  }, []);

  const handleClearQuery = useCallback(() => setQuery(""), []);

  const rootStyle = {
    minWidth: options.minWidth,
    maxWidth: options.maxWidth,
  };

  return (
    <div className={styles.root} style={rootStyle}>
      <div className={styles.searchWrap}>
        <input
          type="text"
          className={styles.search}
          placeholder={options.placeholder || "Search labels…"}
          value={query}
          onChange={handleQueryChange}
          spellCheck={false}
          disabled={!isEditable}
        />
        {query && (
          <button type="button" className={styles.clear} onClick={handleClearQuery} aria-label="Clear search">
            ×
          </button>
        )}
      </div>

      {!hasSelectableRegion && <div className={styles.hint}>Select a region to assign a label</div>}

      {displayed.length === 0 ? (
        <div className={styles.empty}>No matching labels</div>
      ) : (
        <ul className={styles.list} role="listbox">
          {displayed.map((leaf) => {
            const isSelected = selectedKeySet.has(leaf.pathKey);
            const isMru = !trimmedQuery && mruRank.has(leaf.pathKey);
            const className = [
              styles.item,
              isSelected ? styles.itemSelected : "",
              isMru && !isSelected ? styles.itemMru : "",
              !hasSelectableRegion ? styles.itemDim : "",
            ]
              .filter(Boolean)
              .join(" ");
            const disabled = !isEditable || (!isSelected && maxUsagesReached);
            const title = leaf.hint || (leaf.categoryPath.length ? leaf.categoryPath.join(" / ") : undefined);
            return (
              <li key={leaf.pathKey} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  className={className}
                  onClick={() => handleToggle(leaf)}
                  disabled={disabled}
                  title={title}
                >
                  {leaf.color && <span className={styles.colorDot} style={{ background: leaf.color }} />}
                  <span className={styles.label}>{leaf.label}</span>
                  {options.showFullPath && leaf.categoryPath.length > 0 && (
                    <span className={styles.category}>{leaf.categoryPath.join(" / ")}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export { TaxonomyList };
