/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import { taruviStorageProvider } from "../../providers/refineProviders";
import { BUCKETS, FN, callFn, errorMessage, newId, safeFileName } from "../../lib/nip";

const MAX_BYTES = 50 * 1024 * 1024; // matches the nip-uploads bucket limit
const EXT_TO_TYPE: Record<string, "pdf" | "xlsx" | "xls"> = { pdf: "pdf", xlsx: "xlsx", xls: "xls" };

type Props = {
  open: boolean;
  ownerId?: string;
  onClose: () => void;
  onCreated: (runId: string) => void;
};

export const NewValidationModal = ({ open, ownerId, onClose, onCreated }: Props) => {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"idle" | "uploading" | "creating">("idle");

  const reset = () => {
    setFile(null);
    setError(null);
    setBusy("idle");
  };
  const close = () => {
    if (busy !== "idle") return;
    reset();
    onClose();
  };

  const start = async () => {
    setError(null);
    if (!file) return setError("Please choose a file.");
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const sourceType = EXT_TO_TYPE[ext];
    if (!sourceType) return setError("Only PDF (.pdf) and Excel (.xlsx, .xls) files are allowed.");
    if (file.size === 0) return setError("That file is empty.");
    if (file.size > MAX_BYTES) return setError("That file is larger than 50 MB.");
    if (!ownerId) return setError("Your account could not be identified. Please sign in again.");

    // The id is created here because the file path needs it before the run row exists.
    const runId = newId();
    const path = `${ownerId}/${runId}/${Date.now()}_${safeFileName(file.name)}`;

    try {
      setBusy("uploading");
      const res: any = await taruviStorageProvider.create({
        resource: BUCKETS.uploads,
        variables: { files: [file], paths: [path] },
        meta: {},
      } as any);
      const failed = res?.data?.failed ?? res?.failed;
      if (Array.isArray(failed) && failed.length > 0) throw new Error("Upload failed. Please try again.");
    } catch (e) {
      setBusy("idle");
      return setError(
        errorMessage(e).startsWith("You do not have")
          ? "Upload failed. You do not have permission to upload files."
          : "Upload failed. Please try again.",
      );
    }

    try {
      setBusy("creating");
      await callFn(FN.createRun, {
        run_id: runId,
        file_name: file.name,
        file_ref: path,
        source_type: sourceType,
      });
    } catch (e) {
      setBusy("idle");
      return setError(`The file was uploaded but the run could not be created. ${errorMessage(e)}`);
    }

    reset();
    onCreated(runId);
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle>New Validation</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Upload one tabbed application (PDF or Excel). Extraction starts automatically.
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Button
            component="label"
            variant="outlined"
            startIcon={<UploadFileRoundedIcon />}
            disabled={busy !== "idle"}
          >
            {file ? file.name : "Choose file"}
            <input
              hidden
              type="file"
              accept=".pdf,.xlsx,.xls"
              onChange={(e) => {
                setError(null);
                setFile(e.target.files?.[0] ?? null);
              }}
            />
          </Button>
          {busy !== "idle" ? (
            <Stack spacing={0.5}>
              <LinearProgress />
              <Typography variant="caption" color="text.secondary">
                {busy === "uploading" ? "Uploading file…" : "Creating run…"}
              </Typography>
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy !== "idle"}>
          Cancel
        </Button>
        <Button variant="contained" onClick={start} disabled={busy !== "idle"}>
          Start Extraction
        </Button>
      </DialogActions>
    </Dialog>
  );
};
