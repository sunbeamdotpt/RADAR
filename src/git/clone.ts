/**
 * Shallow-clone the configured "base" repository (the sbbb manifests) into a
 * temporary work dir under the system temp dir (k8s read-only-rootfs friendly).
 */

export interface CloneOptions {
  url: string;
  ref: string;
  /** Parent directory for the clone work dir; defaults to Deno.makeTempDir. */
  parentDir?: string;
}

export interface ClonedRepo {
  /** Path of the repository checkout (contains base/ for sbbb-style repos). */
  path: string;
  /** Remove the checkout. Safe to call more than once. */
  cleanup(): Promise<void>;
}

/** git clone --depth 1 --branch <ref> <url> <dir>; throws with stderr on failure. */
export async function cloneRepo(options: CloneOptions): Promise<ClonedRepo> {
  const workDir = await Deno.makeTempDir({ dir: options.parentDir, prefix: "radar-base-" });
  const cmd = new Deno.Command("git", {
    args: ["clone", "--depth", "1", "--branch", options.ref, "--", options.url, workDir],
    stdout: "piped",
    stderr: "piped",
  });
  let output;
  try {
    output = await cmd.output();
  } catch (err) {
    await Deno.remove(workDir, { recursive: true }).catch(() => {});
    throw new Error(`git clone failed to start: ${err}`);
  }
  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    await Deno.remove(workDir, { recursive: true }).catch(() => {});
    throw new Error(`git clone failed: ${options.url}@${options.ref} (${stderr})`);
  }
  let cleaned = false;
  return {
    path: workDir,
    cleanup: async () => {
      if (cleaned) return;
      cleaned = true;
      await Deno.remove(workDir, { recursive: true }).catch(() => {});
    },
  };
}
