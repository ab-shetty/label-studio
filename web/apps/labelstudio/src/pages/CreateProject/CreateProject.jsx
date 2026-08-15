import { EnterpriseBadge, Select, Typography } from "@humansignal/ui";
import React from "react";
import { useHistory } from "react-router";
import { ToggleItems } from "../../components";
import { Button } from "@humansignal/ui";
import { Modal } from "../../components/Modal/Modal";
import { Space } from "../../components/Space/Space";
import { HeidiTips } from "../../components/HeidiTips/HeidiTips";
import { useAPI } from "../../providers/ApiProvider";
import { cn } from "../../utils/bem";
import { ConfigPage } from "./Config/Config";
import "./CreateProject.prefix.css";
import { ImportPage } from "./Import/Import";
import { useImportPage } from "./Import/useImportPage";
import { useDraftProject } from "./utils/useDraftProject";
import { Input, TextArea } from "../../components/Form";
import { FF_LSDV_E_297, isFF } from "../../utils/feature-flags";
import { createURL } from "../../components/HeidiTips/utils";

const ProjectName = ({ name, setName, onSaveName, onSubmit, error, description, setDescription, show = true }) =>
  !show ? null : (
    <form
      className={cn("project-name").toClassName()}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="w-full flex flex-col gap-2">
        <label className="w-full" htmlFor="project_name">
          Project Name
        </label>
        <Input
          name="name"
          id="project_name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={onSaveName}
          className="project-title w-full"
        />
        {error && <span className="-mt-1 text-negative-content">{error}</span>}
      </div>
      <div className="w-full flex flex-col gap-2">
        <label className="w-full" htmlFor="project_description">
          Description
        </label>
        <TextArea
          name="description"
          id="project_description"
          placeholder="Optional description of your project"
          rows="4"
          style={{ minHeight: 100 }}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="project-description w-full"
        />
      </div>
      {isFF(FF_LSDV_E_297) && (
        <div className="w-full flex flex-col gap-2">
          <label>
            Workspace
            <EnterpriseBadge className="ml-tight" />
          </label>
          <Select placeholder="Select an option" disabled options={[]} triggerClassName="!flex-1" />
          <Typography size="small" className="mt-tight mb-wider">
            Simplify project management by organizing projects into workspaces.{" "}
            <a
              href={createURL(
                "https://docs.humansignal.com/guide/manage_projects#Create-workspaces-to-organize-projects",
                {
                  experiment: "project_creation_dropdown",
                  treatment: "simplify_project_management",
                },
              )}
              target="_blank"
              rel="noreferrer"
              className="underline hover:no-underline"
            >
              Learn more
            </a>
          </Typography>
          <HeidiTips collection="projectCreation" />
        </div>
      )}
    </form>
  );

export const CreateProject = ({ onClose }) => {
  const [step, _setStep] = React.useState("name"); // name | import | config
  const [waiting, setWaitingStatus] = React.useState(false);

  const { project, setProject: updateProject } = useDraftProject();
  const history = useHistory();
  const api = useAPI();

  const [name, setName] = React.useState("");
  const [error, setError] = React.useState();
  const [description, setDescription] = React.useState("");
  const [sample, setSample] = React.useState(null);
  const [selectedStorageId, setSelectedStorageId] = React.useState(null);
  const defaultConfigAppliedRef = React.useRef(false);
  // Fired once on mount (not gated on `project`) so it's already in-flight
  // -- or resolved -- well before onCreate can possibly run, regardless of
  // how quickly the user clicks through to Save. onCreate awaits this
  // directly instead of trusting that the state-updating effect below won.
  const groceryConfigPromiseRef = React.useRef(null);
  React.useEffect(() => {
    groceryConfigPromiseRef.current = api
      .callApi("configTemplates")
      .then((res) => res?.templates?.find((t) => t.title === "Grocery Store SKU Labeling")?.config ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setStep = React.useCallback((step) => {
    _setStep(step);
    const eventNameMap = {
      name: "project_name",
      import: "data_import",
      config: "labeling_setup",
    };
    __lsa(`create_project.tab.${eventNameMap[step]}`);
  }, []);

  React.useEffect(() => {
    setError(null);
  }, [name]);

  const { columns, uploading, uploadDisabled, finishUpload, pageProps, uploadSample } = useImportPage(project, sample);

  const rootClass = cn("create-project");
  const tabClass = rootClass.elem("tab");
  const steps = {
    name: <span className={tabClass.mod({ disabled: !!error }).toClassName()}>Project Name</span>,
    import: <span className={tabClass.mod({ disabled: uploadDisabled }).toClassName()}>Data Import</span>,
    config: "Labeling Setup",
  };

  // name intentionally skipped from deps:
  // this should trigger only once when we got project loaded
  React.useEffect(() => {
    project && !name && setName(project.title);
  }, [project]);

  // Default the labeling config to the grocery template so a project is
  // correctly configured even if nobody visits the Labeling Setup tab.
  // Guarded to run (at most) once, and only while the draft still has LS's
  // blank default config -- never clobbers a deliberate user choice.
  React.useEffect(() => {
    if (!project || defaultConfigAppliedRef.current || !groceryConfigPromiseRef.current) return;
    defaultConfigAppliedRef.current = true;

    groceryConfigPromiseRef.current.then((config) => {
      if (config && project.label_config === "<View></View>") {
        updateProject({ ...project, label_config: config });
      }
    });
  }, [project]);

  const projectBody = React.useMemo(
    () => ({
      title: name,
      description,
      label_config: project?.label_config ?? "<View></View>",
    }),
    [name, description, project?.label_config],
  );

  const onCreate = React.useCallback(async () => {
    // Belt-and-suspenders against the config-defaulting effect above losing
    // a race with a fast Save click: if the config is still LS's blank
    // default at publish time, await the same in-flight template fetch
    // directly rather than trusting project.label_config state has synced.
    let labelConfig = projectBody.label_config;
    if (labelConfig === "<View></View>" && groceryConfigPromiseRef.current) {
      const groceryConfig = await groceryConfigPromiseRef.current;
      if (groceryConfig) labelConfig = groceryConfig;
    }

    // First, persist project with label_config so import/reimport validates against it
    const response = await api.callApi("updateProject", {
      params: {
        pk: project.id,
      },
      body: { ...projectBody, label_config: labelConfig, is_draft: false },
    });

    if (response === null) return;

    const imported = await finishUpload();

    if (!imported) return;

    setWaitingStatus(true);

    if (selectedStorageId) {
      // Folder was chosen but never synced (FolderPicker passes sync:false) --
      // do it now that the project is actually being published.
      await api.callApi("syncStorage", { params: { type: "localfiles", pk: selectedStorageId } });
    }

    const defaultMlBackendUrl = window.APP_SETTINGS?.default_ml_backend_url;
    if (defaultMlBackendUrl) {
      // LS refuses to attach a backend it cannot reach, so this fails whenever the
      // RF-DETR process happens to be down at create time. Left unreported, the
      // project is still created and looks fine -- until "Retrieve Predictions"
      // does nothing at all, with no clue as to why. Say so here instead.
      const ml = await api.callApi("addMLBackend", {
        body: { url: defaultMlBackendUrl, project: response.id },
        errorFilter: () => true,
      });

      if (!ml || ml.error) {
        setWaitingStatus(false);
        alert(
          `The project was created, but the RF-DETR ML backend at ${defaultMlBackendUrl} could not be ` +
            "attached — it is probably not running. Pre-annotation will do nothing until you attach it " +
            "under Settings > Machine Learning.",
        );
      }
    }

    if (sample) await uploadSample(sample);

    __lsa("create_project.create", { sample: sample?.url });

    setWaitingStatus(false);

    history.push(`/projects/${response.id}/data`);
  }, [project, projectBody, finishUpload, selectedStorageId]);

  const onSaveName = async () => {
    if (error) return;
    const res = await api.callApi("updateProjectRaw", {
      params: {
        pk: project.id,
      },
      body: {
        title: name,
      },
    });

    if (res.ok) return;
    const err = await res.json();

    setError(err.validation_errors?.title);
  };

  const onDelete = React.useCallback(() => {
    const performClose = async () => {
      setWaitingStatus(true);
      if (project)
        await api.callApi("deleteProject", {
          params: {
            pk: project.id,
          },
        });
      setWaitingStatus(false);
      updateProject(null);
      onClose?.();
    };
    performClose();
  }, [project]);

  return (
    <Modal onHide={onDelete} closeOnClickOutside={false} allowToInterceptEscape fullscreen visible bare>
      <div className={rootClass}>
        <Modal.Header>
          <h1>Create Project</h1>
          <ToggleItems items={steps} active={step} onSelect={setStep} />

          <Space>
            <Button
              variant="negative"
              look="outlined"
              onClick={onDelete}
              waiting={waiting}
              aria-label="Cancel project creation"
            >
              Cancel
            </Button>
            <Button
              look="primary"
              onClick={onCreate}
              waiting={waiting || uploading}
              waitingClickable={false}
              disabled={!project || uploadDisabled || error}
            >
              Save
            </Button>
          </Space>
        </Modal.Header>
        <ProjectName
          name={name}
          setName={setName}
          error={error}
          onSaveName={onSaveName}
          onSubmit={onCreate}
          description={description}
          setDescription={setDescription}
          show={step === "name"}
        />
        <ImportPage
          project={project}
          show={step === "import"}
          sample={sample}
          onSampleDatasetSelect={setSample}
          openLabelingConfig={() => setStep("config")}
          onFolderSelected={setSelectedStorageId}
          {...pageProps}
        />
        <ConfigPage
          project={project}
          onUpdate={(config) => {
            updateProject({ ...project, label_config: config });
          }}
          show={step === "config"}
          columns={columns}
          disableSaveButton={true}
        />
      </div>
    </Modal>
  );
};
