import { useContext, useEffect, useState } from "react";
import { Button, Dropdown, ToastContext, ToastType } from "@humansignal/ui";
import { Menu } from "../../components";
import { useAPI } from "../../providers/ApiProvider";

/**
 * Lets a labeler point this project's local-files import storage at one of the
 * per-person working folders synced from Drive (labeling/in-progress/<name>/),
 * pulling in that folder's images as tasks. Additive by design -- switching
 * folders never removes previously-imported tasks.
 */
export const FolderPicker = ({ project }) => {
  const api = useAPI();
  const toast = useContext(ToastContext);
  const [folders, setFolders] = useState(null);
  const [selecting, setSelecting] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const result = await api.callApi("browseFolders", {
        params: { project: project.id },
      });

      if (!cancelled) setFolders(result?.folders ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const selectFolder = async (folder) => {
    if (selecting) return;

    setSelecting(folder);
    const result = await api.callApi("selectFolder", {
      params: {},
      body: { project: project.id, folder },
    });
    setSelecting(null);

    if (result) {
      toast.show({
        message: `Loaded ${result.last_sync_count} task(s) from "${folder}". Reloading...`,
        type: ToastType.info,
      });
      window.location.reload();
    } else {
      toast.show({
        message: `Couldn't switch to folder "${folder}".`,
        type: ToastType.error,
      });
    }
  };

  return (
    <Dropdown.Trigger
      align="right"
      content={
        <Menu size="compact" style={{ minWidth: 160 }}>
          {folders === null && <Menu.Item>Loading folders...</Menu.Item>}
          {folders?.length === 0 && <Menu.Item>No folders found</Menu.Item>}
          {folders?.map((folder) => (
            <Menu.Item key={folder} onClick={() => selectFolder(folder)}>
              {selecting === folder ? `Loading ${folder}...` : folder}
            </Menu.Item>
          ))}
        </Menu>
      }
    >
      <Button size="small" look="outlined" waiting={selecting !== null} aria-label="Choose working folder">
        Working folder
      </Button>
    </Dropdown.Trigger>
  );
};
