import { useContext, useEffect, useState } from "react";
import { Button, Dropdown, ToastContext, ToastType } from "@humansignal/ui";
import { Menu } from "../../../components";
import { useAPI } from "../../../providers/ApiProvider";

/**
 * Lets a labeler pick one of the per-person working folders synced from Drive
 * (labeling/in-progress/<name>/) as this draft project's data source. Points
 * the project's local-files import storage at the chosen folder without
 * syncing yet -- CreateProject.jsx defers the actual sync to final publish,
 * same as uploaded files, so an abandoned draft doesn't leave synced tasks
 * behind.
 */
export const FolderPicker = ({ project, onFolderSelected }) => {
  const api = useAPI();
  const toast = useContext(ToastContext);
  const [folders, setFolders] = useState(null);
  const [selecting, setSelecting] = useState(null);
  const [selected, setSelected] = useState(null);

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
      body: { project: project.id, folder, sync: false },
    });
    setSelecting(null);

    if (result) {
      setSelected(folder);
      onFolderSelected?.(result.id, folder);
      toast.show({
        message: `Working folder set to "${folder}" -- images will be pulled in when you save.`,
        type: ToastType.info,
      });
    } else {
      toast.show({
        message: `Couldn't select folder "${folder}".`,
        type: ToastType.error,
      });
    }
  };

  return (
    <Dropdown.Trigger
      align="left"
      content={
        <Menu size="compact" style={{ minWidth: 160 }}>
          {folders === null && <Menu.Item>Loading folders...</Menu.Item>}
          {folders?.length === 0 && <Menu.Item>No folders found</Menu.Item>}
          {folders?.map((folder) => (
            <Menu.Item key={folder} onClick={() => selectFolder(folder)}>
              {selecting === folder ? `Selecting ${folder}...` : folder}
            </Menu.Item>
          ))}
        </Menu>
      }
    >
      <Button
        variant="primary"
        look="outlined"
        type="button"
        waiting={selecting !== null}
        aria-label="Choose working folder"
      >
        {selected ? `Folder: ${selected}` : "Working Folder"}
      </Button>
    </Dropdown.Trigger>
  );
};
