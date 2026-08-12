import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WaitlistForm } from "./waitlist-form";

describe("WaitlistForm", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("submits a normalized email and shows confirmation", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", request);
    const user = userEvent.setup();

    render(<WaitlistForm />);
    await user.type(screen.getByLabelText("Correo"), "Person@Example.com ");
    await user.click(screen.getByRole("button", { name: "Solicitar acceso" }));

    expect(await screen.findByText("Estás en la lista privada.")).toBeVisible();
    expect(request).toHaveBeenCalledWith(
      "http://localhost:4001/v1/waitlist",
      expect.objectContaining({
        body: JSON.stringify({ email: "person@example.com" }),
        method: "POST",
      }),
    );
  });

  it("guides the user when the email is invalid", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const user = userEvent.setup();

    render(<WaitlistForm />);
    await user.type(screen.getByLabelText("Correo"), "correo-incompleto");
    await user.click(screen.getByRole("button", { name: "Solicitar acceso" }));

    expect(screen.getByText("Escribe un correo válido.")).toBeVisible();
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps the email and offers a retry after a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const user = userEvent.setup();

    render(<WaitlistForm />);
    const input = screen.getByLabelText("Correo");
    await user.type(input, "persona@example.com");
    await user.click(screen.getByRole("button", { name: "Solicitar acceso" }));

    expect(
      await screen.findByText("No pudimos conectar. Revisa tu conexión e inténtalo de nuevo."),
    ).toBeVisible();
    expect(input).toHaveValue("persona@example.com");
    expect(screen.getByRole("button", { name: "Intentar de nuevo" })).toBeEnabled();
  });

  it("treats an existing waitlist email as a successful request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }))));
    const user = userEvent.setup();

    render(<WaitlistForm />);
    await user.type(screen.getByLabelText("Correo"), "persona@example.com");
    await user.click(screen.getByRole("button", { name: "Solicitar acceso" }));

    expect(await screen.findByText("Estás en la lista privada.")).toBeVisible();
  });

  it("prevents a second submission while the request is pending", async () => {
    let finishRequest: ((response: Response) => void) | undefined;
    const pendingRequest = new Promise<Response>((resolve) => {
      finishRequest = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pendingRequest));
    const user = userEvent.setup();

    render(<WaitlistForm />);
    await user.type(screen.getByLabelText("Correo"), "persona@example.com");
    await user.click(screen.getByRole("button", { name: "Solicitar acceso" }));

    expect(screen.getByRole("button", { name: "Solicitando…" })).toBeDisabled();
    finishRequest?.(new Response(JSON.stringify({ ok: true })));
    expect(await screen.findByText("Estás en la lista privada.")).toBeVisible();
  });
});
