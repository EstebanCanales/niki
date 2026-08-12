import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ProductDemo } from "./product-demo";

describe("ProductDemo", () => {
  afterEach(cleanup);

  it("makes the agent state understandable without relying on motion", async () => {
    const user = userEvent.setup();

    render(<ProductDemo />);
    expect(
      screen.getByRole("region", { name: "Presencia de Niki" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Niki está escuchando")).toBeVisible();
    expect(screen.getByRole("button", { name: "Escuchar" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Pensar" }));

    expect(screen.getByLabelText("Niki está pensando")).toBeVisible();
    expect(screen.getByRole("button", { name: "Pensar" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Escuchar" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("Pensando contigo.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Actuar" }));

    expect(screen.getByLabelText("Niki está actuando")).toBeVisible();
    expect(screen.getByRole("button", { name: "Actuar" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Listo para actuar, cuando tú confirmes.")).toBeVisible();
  });
});
