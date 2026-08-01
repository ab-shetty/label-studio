import { types } from "mobx-state-tree";
import { PER_REGION_MODES } from "./PerRegionModes";

/**
 * This mixing defines perRegion control tag's parameter and related basic functionality
 * It should be used right after ClassificationBase mixin
 * @see ClassificationBase
 */
const PerRegionMixin = types
  .model({
    perregion: types.optional(types.boolean, false),
    whenlabelvalue: types.maybeNull(types.string),
    displaymode: types.optional(types.enumeration(Object.values(PER_REGION_MODES)), PER_REGION_MODES.TAG),
  })
  .extend((self) => {
    /* Validation */
    if (self.isClassificationTag !== true) {
      throw new Error("The PerRegionMixin mixin should be used only for classification control-tags");
    }
    return {};
  })
  .volatile(() => {
    return {
      focusable: false,
    };
  })
  .views((self) => ({
    get perRegionArea() {
      if (!self.perregion) return null;
      return self.annotation.highlightedNode;
    },
    get _perRegionResult() {
      const area = self.perRegionArea;

      if (!area) return null;

      // Two shapes exist for a per-region result: manually creating one
      // (draw a region, then classify it) reuses the SAME area object
      // (r.area === area, via createPerRegionResult -> area.setValue). But a
      // result loaded from serialized JSON with its own `id` linked via
      // `parentID` (e.g. predictions -- our RF-DETR backend emits a separate
      // taxonomy result per box, parentID pointing at the box's id) becomes
      // its own distinct Area object on deserialize, so r.area !== area even
      // though it correctly belongs to this region. Match either shape.
      return self.annotation.results.find(
        (r) => r.from_name === self && (r.area === area || r.area?.parentID === area.id),
      );
    },
    perRegionVisible() {
      if (!self.perregion) return true;

      const region = self.perRegionArea;

      if (!region) {
        // no region is selected return hidden
        return false;
      }
      // check if selected region is the one this tag is connected to
      if (region.parent.name !== self.toname) return false;

      // we may need to check for specific value
      if (self.whenlabelvalue !== null && self.whenlabelvalue !== undefined)
        return region.hasLabel(self.whenlabelvalue);

      return true;
    },
  }))
  .actions((self) => ({
    /**
     * Validates all values related to the current classification per region.
     *
     * - This method should not be overridden.
     * - It is used only in validate method of the ClassificationBase mixin.
     *
     * @returns {boolean}
     * @private
     */
    _validatePerRegion() {
      const objectTag = self.toNameTag;

      for (const reg of objectTag.allRegs) {
        const value = reg.results.find((s) => s.from_name === self)?.mainValue;
        const isValid = self.validateValue(value);

        if (!isValid) {
          self.annotation.selectArea(reg);
          return false;
        }
      }

      return true;
    },
    createPerRegionResult() {
      self.perRegionArea?.setValue(self);
    },
  }));

export default PerRegionMixin;
export { PER_REGION_MODES } from "./PerRegionModes";
