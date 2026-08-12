import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { BentoShell } from "./bento-shell";

describe("BentoShell", () => {
  afterEach(cleanup);

  it("presents Niki as one focused product shell without site navigation", () => {
    const { container } = render(<BentoShell />);

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(container.querySelector("header")).not.toBeInTheDocument();
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelectorAll("[data-plane]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-notch]")).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Tu Mac, ahora te entiende." }),
    ).toBeVisible();
    expect(screen.getByAltText("Niki")).toHaveAttribute(
      "src",
      expect.stringContaining("logo-niki.svg"),
    );
    expect(screen.getByLabelText("Correo")).toBeVisible();
    expect(screen.getByRole("button", { name: "Solicitar acceso" })).toBeVisible();
  });

  it("embeds returning access and waitlist feedback in the hero flow", async () => {
    const user = userEvent.setup();
    render(<BentoShell />);
    const access = screen.getByRole("region", { name: "Acceso privado" });

    expect(within(access).getByRole("link", { name: "Entrar a Niki" })).toHaveAttribute(
      "href",
      "/login",
    );
    await user.click(within(access).getByRole("button", { name: "Solicitar acceso" }));

    const error = within(access).getByRole("alert");
    expect(error).toHaveTextContent("Escribe un correo válido.");
    expect(within(access).getByText("Acceso personal por invitación.")).toBeVisible();
    expect(error.closest("form")).not.toBeNull();
  });

  it("keeps the product narrative in three quiet editorial planes", () => {
    render(<BentoShell />);
    const shell = screen.getByRole("main");

    expect(within(shell).getByRole("region", { name: "Presencia de Niki" })).toBeVisible();
    expect(
      within(shell).getByRole("region", { name: "Una conversación continua" }),
    ).toBeVisible();
    expect(within(shell).getByRole("region", { name: "Contexto y privacidad" })).toBeVisible();
    expect(screen.getByText("Niki trabaja contigo, no por encima de ti.")).toBeVisible();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });
});
