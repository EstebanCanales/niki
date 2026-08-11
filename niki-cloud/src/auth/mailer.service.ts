import { Injectable, ServiceUnavailableException } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";

@Injectable()
export class MailerService {
  constructor(private readonly config: AppConfigService) {}

  async sendMagicCode(email: string, code: string): Promise<void> {
    if (!this.config.resendApiKey || !this.config.mailFrom) {
      throw new ServiceUnavailableException("Email delivery is not configured");
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.config.mailFrom,
        to: [email],
        subject: "Your Niki sign-in code",
        text: `Your Niki sign-in code is ${code}. It expires in 10 minutes.`,
      }),
    });

    if (!response.ok) {
      throw new ServiceUnavailableException("Unable to send magic code");
    }
  }
}
