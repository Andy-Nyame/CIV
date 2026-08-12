import type { Metadata } from "next";

import { PageHeading } from "@/components/ui/page-heading";
import { PasswordSettingsForm } from "@/components/ui/password-settings-form";
import { ProfileNameForm } from "@/components/ui/profile-name-form";
import { ProfilePhotoControl } from "@/components/ui/profile-photo-control";
import { SignatureWorkspace } from "@/components/ui/signature-workspace";
import { getPersonalProfile } from "@/features/profile/queries";

export const metadata: Metadata = { title: "Profile & Account" };

function SettingSection({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="grid gap-6 border-t border-border py-8 first:border-t-0 first:pt-0 md:grid-cols-[13rem_minmax(0,1fr)]">
      <div>
        <h2 className="text-base font-semibold text-text">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export default async function ProfilePage() {
  const profile = await getPersonalProfile();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeading
        title="Profile & Account"
        description="Manage your personal CIV identity, sign-in security, and signature preferences."
      />

      <div className="mt-8 rounded-2xl border border-border bg-surface p-5 sm:p-7 lg:p-8">
        <SettingSection
          title="Profile"
          description="Your personal identity is separate from every workspace you belong to."
        >
          <div className="grid gap-7">
            <ProfilePhotoControl
              email={profile.email}
              image={profile.image}
              name={profile.name}
            />
            <ProfileNameForm name={profile.name} />
            <label className="grid gap-2 text-sm font-semibold text-text" htmlFor="profile-email">
              Account email
              <input
                id="profile-email"
                className="min-h-12 rounded-lg border border-border bg-page px-3.5 font-normal text-muted"
                value={profile.email ?? "Email unavailable"}
                readOnly
              />
              <span className="font-normal leading-6 text-muted">
                Email changes are not available in this phase.
              </span>
            </label>
          </div>
        </SettingSection>

        <SettingSection
          title="Security"
          description="Review your connected sign-in methods and protect your CIV account."
        >
          <div className="grid gap-7">
            <div>
              <h3 className="text-sm font-semibold text-text">Sign-in methods</h3>
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Connected sign-in methods">
                {profile.hasPassword ? (
                  <li className="rounded-full border border-border bg-page px-3 py-1.5 text-sm font-semibold text-text">
                    Password · Connected
                  </li>
                ) : null}
                {profile.hasGoogle ? (
                  <li className="rounded-full border border-border bg-page px-3 py-1.5 text-sm font-semibold text-text">
                    Google · Connected
                  </li>
                ) : null}
              </ul>
            </div>
            <div>
              <h3 className="text-base font-semibold text-text">
                {profile.hasPassword ? "Change password" : "Set a CIV password"}
              </h3>
              <p className="mt-1 mb-5 text-sm leading-6 text-muted">
                {profile.hasPassword
                  ? "Your current session can remain active. Future credentials sign-ins will require the new password."
                  : "Add password sign-in to this same account without disconnecting Google."}
              </p>
              <PasswordSettingsForm hasPassword={profile.hasPassword} />
            </div>
          </div>
        </SettingSection>

        <SettingSection
          title="Signature"
          description="Your saved personal signature can later be used when you authorize CIV documents."
        >
          <div className="grid gap-5">
            <div className="rounded-lg border border-border bg-page px-4 py-3 text-sm leading-6 text-muted">
              A handwritten signature is a personal visual mark. It is not itself a cryptographic signature or a GRA security element.
            </div>
            {profile.signature ? (
              <p className="text-sm text-muted">
                Signature metadata exists for this account. Private asset delivery will be enabled with CIV storage.
              </p>
            ) : null}
            <SignatureWorkspace />
          </div>
        </SettingSection>
      </div>
    </div>
  );
}
