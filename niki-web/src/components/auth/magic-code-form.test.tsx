import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MagicCodeForm } from "./magic-code-form";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

describe("MagicCodeForm", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("requests a code with the normalized email and opens the code step", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", request);
    const user = userEvent.setup();

    render(<MagicCodeForm />);
    await user.type(screen.getByLabelText("Correo"), " Person@Example.com ");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));

    expect(await screen.findByLabelText("Código de seis dígitos")).toBeVisible();
    expect(screen.getByText("Enviamos un código a person@example.com.")).toBeVisible();
    expect(request).toHaveBeenCalledWith(
      "http://localhost:4001/v1/auth/request-code",
      expect.objectContaining({
        body: JSON.stringify({ email: "person@example.com" }),
        credentials: "include",
        method: "POST",
      }),
    );
  });

  it("requires exactly six digits before verifying", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal("fetch", request);
    const user = userEvent.setup();

    render(<MagicCodeForm />);
    await user.type(screen.getByLabelText("Correo"), "person@example.com");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    await user.type(await screen.findByLabelText("Código de seis dígitos"), "12345");
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    expect(screen.getByText("Escribe los seis dígitos del código.")).toBeVisible();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("shows a useful error when the code is invalid", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 201 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Invalid or expired magic code" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", request);
    const user = userEvent.setup();

    render(<MagicCodeForm />);
    await user.type(screen.getByLabelText("Correo"), "person@example.com");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    await user.type(await screen.findByLabelText("Código de seis dígitos"), "123456");
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByText("El código no es válido o ya venció.")).toBeVisible();
    expect(screen.getByLabelText("Código de seis dígitos")).toHaveValue("");
  });

  it("redirects to the portal after a successful verification", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 201 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: { id: "user-1", email: "person@example.com", displayName: null },
          }),
          { status: 201 },
        ),
      );
    vi.stubGlobal("fetch", request);
    const user = userEvent.setup();

    render(<MagicCodeForm />);
    await user.type(screen.getByLabelText("Correo"), "person@example.com");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    await user.type(await screen.findByLabelText("Código de seis dígitos"), "123456");
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    expect(request).toHaveBeenLastCalledWith(
      "http://localhost:4001/v1/auth/verify-code",
      expect.objectContaining({
        body: JSON.stringify({ email: "person@example.com", code: "123456" }),
        credentials: "include",
        method: "POST",
      }),
    );
    expect(push).toHaveBeenCalledWith("/dashboard");
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the development debug code returned by the cloud", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, debugCode: "654321" }), { status: 201 }),
      ),
    );
    const user = userEvent.setup();

    render(<MagicCodeForm />);
    await user.type(screen.getByLabelText("Correo"), "person@example.com");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));

    expect(await screen.findByText("Código local: 654321")).toBeVisible();
  });

  it("matches the cloud code lifetime before exposing resend", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 })),
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(<MagicCodeForm />);
    await user.type(screen.getByLabelText("Correo"), "person@example.com");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));

    expect(await screen.findByRole("button", { name: /Reenviar en (10:00|9:59)/ })).toBeDisabled();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(screen.getByRole("button", { name: "Reenviar código" })).toBeEnabled();
  });
});
