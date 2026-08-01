import { Button, Tooltip } from "@humansignal/ui";
import { inject, observer } from "mobx-react";
import { useMemo, useRef } from "react";
import { useActions } from "../../../hooks/useActions";
import { invokeAction } from "./ActionsButton";

// Shortcut for the built-in "Retrieve Predictions" bulk action (normally
// buried inside the Actions dropdown) -- surfaces it as its own button so
// it's discoverable without knowing it's in there. Reuses the same
// confirm-dialog/invocation path as ActionsButton so behavior stays
// identical (send selected tasks to the project's connected ML backend).
const injector = inject(({ store }) => ({
  store,
  hasSelected: store.currentView?.selected?.hasSelected ?? false,
}));

export const PreAnnotateButton = injector(
  observer(({ store, hasSelected, size }) => {
    const formRef = useRef();
    const { actions: serverActions } = useActions({ enabled: true, projectId: store.SDK.projectId });

    const action = useMemo(() => {
      return [...store.availableActions, ...serverActions].find((a) => a.id === "retrieve_tasks_predictions");
    }, [store.availableActions, serverActions]);

    const disabled = !hasSelected || !action;

    const button = (
      <Button
        size={size}
        variant="neutral"
        look="outlined"
        disabled={disabled}
        aria-label="Pre-annotate selected tasks"
        onClick={() => action && invokeAction(action, false, store, formRef)}
      >
        Pre-annotate
      </Button>
    );

    return hasSelected ? (
      button
    ) : (
      <Tooltip title="Select tasks to pre-annotate">
        <div>{button}</div>
      </Tooltip>
    );
  }),
);
