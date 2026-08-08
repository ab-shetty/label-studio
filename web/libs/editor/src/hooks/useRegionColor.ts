import chroma from "chroma-js";
import { observe } from "mobx";
import { useContext, useEffect, useMemo, useState } from "react";
import { ImageViewContext } from "../components/ImageView/ImageViewContext";
import Constants, { defaultStyle } from "../core/Constants";
import { isDefined } from "../utils/utilities";

// An unaccepted proposal has to be readable as "not yours yet" at a glance,
// while a frame is carrying dozens of boxes. Amber reads as provisional next
// to the blue of a drawn region, and is not the red the editor already uses
// for the selected one. The dash carries the same signal for anyone who does
// not separate those hues.
const PROPOSAL_STROKE_COLOR = "#f5a623";
const PROPOSAL_DASH = [6, 4];

const defaultStyles = {
  defaultOpacity: defaultStyle.opacity,
  defaultFillColor: defaultStyle.fillcolor,
  defaultStrokeColor: defaultStyle.strokecolor,
  defaultStrokeColorHighlighted: Constants.HIGHLIGHTED_STROKE_COLOR,
  defaultStrokeWidth: defaultStyle.strokewidth,
  defaultStrokeWidthHighlighted: Constants.HIGHLIGHTED_STROKE_WIDTH,
  defaultSuggestionWidth: Constants.SUGGESTION_STROKE_WIDTH,
};

type StyleOptions = typeof defaultStyles & {
  region: any;
  highlighted?: boolean;
  shouldFill?: boolean;
  suggestion?: boolean;
  includeFill?: boolean;
  useStrokeAsFill?: boolean;
  sameStrokeWidthForSelected?: boolean;
};

export const getRegionStyles = ({
  region,
  highlighted = false,
  shouldFill = false,
  useStrokeAsFill = false,
  sameStrokeWidthForSelected = false,
  suggestion = false,
  defaultOpacity = defaultStyle.opacity,
  defaultFillColor = defaultStyle.fillcolor,
  defaultStrokeColor = defaultStyle.strokecolor,
  defaultStrokeColorHighlighted = Constants.HIGHLIGHTED_STROKE_COLOR,
  defaultStrokeWidth = defaultStyle.strokewidth,
  defaultStrokeWidthHighlighted = Constants.HIGHLIGHTED_STROKE_WIDTH,
  defaultSuggestionWidth = Constants.SUGGESTION_STROKE_WIDTH,
}: StyleOptions) => {
  const style = region.style || region.tag;

  const selected = region.inSelection || highlighted;

  const fillopacity = style?.fillopacity;
  const opacity = isDefined(fillopacity) ? fillopacity : style?.opacity;

  const fillColor = shouldFill
    ? chroma((useStrokeAsFill ? style?.strokecolor : style?.fillcolor) ?? defaultFillColor)
        .darken(0.3)
        .alpha(+(opacity ?? defaultOpacity ?? 0.5))
        .css()
    : null;

  // Selection still wins: while you are working on a box you need to see
  // which one it is more than you need to see where it came from.
  const proposal = region.isProposal === true && !selected;

  const strokeColor = selected
    ? defaultStrokeColorHighlighted
    : proposal
      ? PROPOSAL_STROKE_COLOR
      : chroma(style?.strokecolor ?? defaultStrokeColor).css();

  const strokeWidth = (() => {
    if (suggestion) {
      return defaultSuggestionWidth;
    }
    if (selected && !sameStrokeWidthForSelected) {
      return defaultStrokeWidthHighlighted;
    }
    return +(style?.strokewidth ?? defaultStrokeWidth);
  })();

  return {
    strokeColor,
    fillColor,
    strokeWidth,
    dash: proposal ? PROPOSAL_DASH : undefined,
  };
};

export const useRegionStyles = (region: any, options: Partial<StyleOptions> = {}) => {
  const { suggestion } = useContext(ImageViewContext) ?? {};
  const [highlighted, setHighlighted] = useState(region.highlighted);
  const [shouldFill, setShouldFill] = useState(region.fill ?? (options.useStrokeAsFill || options.includeFill));
  // Read through region.isProposal rather than from this state, but kept in
  // the memo deps so accepting a proposal repaints the box immediately
  // instead of on the next unrelated re-render.
  const [origin, setOrigin] = useState(region.origin);

  const styles = useMemo(() => {
    return getRegionStyles({
      ...defaultStyles,
      ...(options ?? {}),
      highlighted,
      shouldFill,
      region,
      suggestion,
    });
  }, [region, suggestion, options, highlighted, shouldFill, origin]);

  useEffect(() => {
    const disposeObserver = ["highlighted", "fill", "origin"].map((prop) => {
      try {
        return observe(
          region,
          prop,
          ({ newValue }) => {
            switch (prop) {
              case "highlighted":
                return setHighlighted(newValue);
              case "fill":
                return setShouldFill(newValue);
              case "origin":
                return setOrigin(newValue);
            }
          },
          true,
        );
      } catch (e) {
        return () => {};
      }
    });

    return () => {
      disposeObserver.forEach((dispose) => dispose());
    };
  }, [region]);

  return styles;
};
