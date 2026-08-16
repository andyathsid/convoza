"use client"

import { useState, useRef, useCallback } from "react"
import { cn } from "@/lib/utils"
import {
  ChevronLeftIcon,
  CameraIcon,
  UserIcon,
  ShieldIcon,
  KeyRoundIcon,
  LogOutIcon,
  CheckIcon,
  Loader2Icon,
  LinkIcon,
  UnlinkIcon,
} from "lucide-react"
import {
  updateProfile,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  linkWithCredential,
  linkWithPopup,
  GoogleAuthProvider,
} from "firebase/auth"
import { auth } from "@/lib/firebase"
import { useAuth, getFirebaseEmail } from "@/features/auth"
import { api } from "@/lib/api"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

const passwordFormSchema = z
  .object({
    newPassword: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string().min(6, "Password must be at least 6 characters"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })

const changePasswordFormSchema = passwordFormSchema.extend({
  currentPassword: z.string().min(1, "Current password is required"),
})

type SettingsView = "main" | "profile" | "providers" | "password"

interface SettingsPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsPopover({ open, onOpenChange }: SettingsPopoverProps) {
  const [view, setView] = useState<SettingsView>("main")
  const user = useAuth((s) => s.user)
  const signOut = useAuth((s) => s.signOut)

  const handleBack = useCallback(() => setView("main"), [])

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) setView("main")
      onOpenChange(isOpen)
    },
    [onOpenChange]
  )

  // Stable callback for child views to update user state
  const updateUser = useCallback(
    (updated: NonNullable<typeof user>) =>
      useAuth.setState({ user: updated }),
    []
  )

  if (!user) return null

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="left" showCloseButton={false} className="p-0 gap-0 w-full sm:max-w-[380px]">
        {view === "main" && (
          <MainView user={user} onNavigate={setView} onSignOut={signOut} />
        )}
        {view === "profile" && (
          <ProfileView user={user} onBack={handleBack} onUserUpdate={updateUser} />
        )}
        {view === "providers" && (
          <ProvidersView user={user} onBack={handleBack} onUserUpdate={updateUser} />
        )}
        {view === "password" && (
          <PasswordView user={user} onBack={handleBack} />
        )}
      </SheetContent>
    </Sheet>
  )
}

// ─── Main View ─────────────────────────────────────────────

function MainView({
  user,
  onNavigate,
  onSignOut,
}: {
  user: NonNullable<ReturnType<typeof useAuth.getState>["user"]>
  onNavigate: (view: SettingsView) => void
  onSignOut: () => Promise<void>
}) {
  const initials = user.username
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  return (
    <div className="flex flex-col h-full">
      <SheetHeader className="flex flex-row items-center gap-3 p-4 pb-2">
        <SheetTitle>Settings</SheetTitle>
      </SheetHeader>

      <ScrollArea className="flex-1">
        {/* Profile card */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            <Avatar size="lg">
              <AvatarImage src={user.avatar || undefined} alt={user.username} />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-heading font-medium truncate">{user.username}</p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
          </div>
        </div>

        <Separator />

        {/* Settings list */}
        <div className="py-1">
          <SettingsItem
            icon={UserIcon}
            label="Profile"
            onClick={() => onNavigate("profile")}
          />
          <SettingsItem
            icon={ShieldIcon}
            label="Account & Providers"
            onClick={() => onNavigate("providers")}
          />
          <SettingsItem
            icon={KeyRoundIcon}
            label="Password"
            onClick={() => onNavigate("password")}
          />
        </div>
      </ScrollArea>

      {/* Logout button */}
      <div className="p-4 border-t border-border">
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={onSignOut}
        >
          <LogOutIcon className="size-4" />
          Log out
        </Button>
      </div>
    </div>
  )
}

function SettingsItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}) {
  return (
    <button
      className="flex items-center gap-3 w-full px-4 py-3 text-sm hover:bg-sidebar-accent transition-colors text-left"
      onClick={onClick}
    >
      <Icon className="size-4 text-muted-foreground" />
      <span className="flex-1">{label}</span>
      <ChevronLeftIcon className="size-4 text-muted-foreground rotate-180" />
    </button>
  )
}

// ─── Profile View ──────────────────────────────────────────

function ProfileView({
  user,
  onBack,
  onUserUpdate,
}: {
  user: NonNullable<ReturnType<typeof useAuth.getState>["user"]>
  onBack: () => void
  onUserUpdate: (u: typeof user) => void
}) {
  const [displayName, setDisplayName] = useState(user.username)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saved, setSaved] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSave = async () => {
    if (!auth || !auth.currentUser || !displayName.trim()) return
    setSaving(true)
    try {
      await updateProfile(auth.currentUser, { displayName: displayName.trim() })
      onUserUpdate({ ...user, username: displayName.trim() })

      // Sync username to backend
      await api.post("/auth/sync", { username: displayName.trim() })

      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error("Failed to update display name:", err)
    } finally {
      setSaving(false)
    }
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!auth || !file || !auth.currentUser) return

    setUploading(true)
    try {
      const body = new FormData()
      body.set("avatar", file)
      // Persist through the authorization boundary before changing local identity
      // state, so a verification failure cannot leave the UI ahead of the backend.
      const response = await api.postForm("/users/avatar", body)
      await updateProfile(auth.currentUser, { photoURL: response.avatarURL })
      onUserUpdate({ ...user, avatar: response.avatarURL })
    } catch (err) {
      console.error("Failed to upload avatar:", err)
    } finally {
      setUploading(false)
    }
  }

  const initials = user.username
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  return (
    <div className="flex flex-col h-full">
      <SheetHeader className="flex flex-row items-center gap-3 p-4 pb-2">
        <Button variant="ghost" size="icon-sm" onClick={onBack}>
          <ChevronLeftIcon className="size-4" />
        </Button>
        <SheetTitle>Profile</SheetTitle>
      </SheetHeader>

      <ScrollArea className="flex-1">
        <div className="px-4 py-6 flex flex-col items-center gap-4">
          {/* Avatar */}
          <div className="relative group">
            <Avatar className="size-24 text-2xl">
              <AvatarImage src={user.avatar || undefined} alt={user.username} />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <button
              className={cn(
                "absolute inset-0 rounded-full bg-black/40 flex items-center justify-center transition-opacity cursor-pointer",
                uploading ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              )}
              onClick={() => !uploading && fileInputRef.current?.click()}
              type="button"
              disabled={uploading}
            >
              {uploading ? (
                <Loader2Icon className="size-6 text-white animate-spin" />
              ) : (
                <CameraIcon className="size-6 text-white" />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
              disabled={uploading}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Click the avatar to change
          </p>

          {/* Display name */}
          <div className="w-full space-y-2">
            <Label htmlFor="display-name">Display name</Label>
            <div className="flex gap-2 items-center">
              <Input
                id="display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                disabled={saving}
              />
              <Button
                size="icon-sm"
                onClick={handleSave}
                disabled={saving || !displayName.trim() || displayName === user.username}
              >
                {saving ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : saved ? (
                  <CheckIcon className="size-4" />
                ) : (
                  <CheckIcon className="size-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Email (read-only) */}
          <div className="w-full space-y-2">
            <Label>Email</Label>
            <Input value={user.email} disabled />
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

// ─── Providers View ────────────────────────────────────────

function ProvidersView({
  user,
  onBack,
  onUserUpdate,
}: {
  user: NonNullable<ReturnType<typeof useAuth.getState>["user"]>
  onBack: () => void
  onUserUpdate: (u: typeof user) => void
}) {
  const [linking, setLinking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentUser = auth?.currentUser ?? null
  const providers = currentUser?.providerData.map((p) => p.providerId) ?? []
  const hasGoogle = providers.includes("google.com")
  const hasEmailPassword = providers.includes("password")

  const handleLinkGoogle = async () => {
    if (!currentUser) return
    setLinking(true)
    setError(null)
    try {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: "select_account" })
      await linkWithPopup(currentUser, provider)

      // Sync with backend after linking
      const idToken = await currentUser.getIdToken(true)
      const res = await api.post("/auth/sync", { firebase_uid: currentUser.uid })
      onUserUpdate(res.user)
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("auth/credential-already-in-use")) {
        setError("This Google account is already linked to another user.")
      } else if (err instanceof Error && err.message.includes("auth/popup-closed-by-user")) {
        // User cancelled the popup, no need to show an error
      } else {
        setError(err instanceof Error ? err.message : "Failed to link Google account")
      }
    } finally {
      setLinking(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <SheetHeader className="flex flex-row items-center gap-3 p-4 pb-2">
        <Button variant="ghost" size="icon-sm" onClick={onBack}>
          <ChevronLeftIcon className="size-4" />
        </Button>
        <SheetTitle>Account & Providers</SheetTitle>
      </SheetHeader>

      <ScrollArea className="flex-1">
        <div className="px-4 py-3 space-y-4">
          <p className="text-sm text-muted-foreground">
            Manage your connected sign-in methods.
          </p>

          {/* Provider list */}
          <div className="space-y-2">
            <ProviderItem
              name="Google"
              connected={hasGoogle}
              icon={
                <svg className="size-4" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
              }
            />
            <ProviderItem
              name="Email & Password"
              connected={hasEmailPassword}
              icon={<KeyRoundIcon className="size-4 text-muted-foreground" />}
            />
          </div>

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          {/* Link actions */}
          {!hasGoogle && (
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={handleLinkGoogle}
              disabled={linking}
            >
              {linking ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <LinkIcon className="size-4" />
              )}
              Link Google Account
            </Button>
          )}

          {!hasEmailPassword && (
            <div className="rounded-lg border border-border p-3 space-y-2">
              <p className="text-sm font-medium">Set a password</p>
              <p className="text-xs text-muted-foreground">
                Add email/password sign-in by setting a password in the Password section.
                This will let you sign in with either Google or email and password.
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function ProviderItem({
  name,
  connected,
  icon,
}: {
  name: string
  connected: boolean
  icon: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border">
      {icon}
      <span className="flex-1 text-sm font-medium">{name}</span>
      {connected ? (
        <Badge variant="secondary" className="gap-1">
          <CheckIcon className="size-3" />
          Connected
        </Badge>
      ) : (
        <Badge variant="outline" className="gap-1">
          <UnlinkIcon className="size-3" />
          Not connected
        </Badge>
      )}
    </div>
  )
}

// ─── Password View ─────────────────────────────────────────

function PasswordView({
  user,
  onBack,
}: {
  user: NonNullable<ReturnType<typeof useAuth.getState>["user"]>
  onBack: () => void
}) {
  const currentUser = auth?.currentUser ?? null
  const providers = currentUser?.providerData.map((p) => p.providerId) ?? []
  const hasEmailPassword = providers.includes("password")

  return (
    <div className="flex flex-col h-full">
      <SheetHeader className="flex flex-row items-center gap-3 p-4 pb-2">
        <Button variant="ghost" size="icon-sm" onClick={onBack}>
          <ChevronLeftIcon className="size-4" />
        </Button>
        <SheetTitle>Password</SheetTitle>
      </SheetHeader>

      <ScrollArea className="flex-1">
        <div className="px-4 py-3">
          {hasEmailPassword ? (
            <ChangePasswordForm />
          ) : (
            <SetPasswordForm />
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function ChangePasswordForm() {
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  const form = useForm<z.infer<typeof changePasswordFormSchema>>({
    resolver: zodResolver(changePasswordFormSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  })

  const onSubmit = async (values: z.infer<typeof changePasswordFormSchema>) => {
    if (!auth?.currentUser) return
    const email = getFirebaseEmail(auth.currentUser)
    if (!email) return

    setSaving(true)
    try {
      const credential = EmailAuthProvider.credential(
        email,
        values.currentPassword
      )
      await reauthenticateWithCredential(auth.currentUser, credential)
      await updatePassword(auth.currentUser, values.newPassword)
      setSuccess(true)
      form.reset()
      setTimeout(() => setSuccess(false), 3000)
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to change password"
      form.setError("root", { type: "manual", message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Update your password. You&apos;ll need to enter your current password first.
        </p>

        {form.formState.errors.root && (
          <p className="text-xs text-destructive">{form.formState.errors.root.message}</p>
        )}
        {success && (
          <p className="text-xs text-green-600 dark:text-green-400">
            Password changed successfully
          </p>
        )}

        <FormField
          control={form.control}
          name="currentPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Current password</FormLabel>
              <FormControl>
                <PasswordInput id="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="newPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
              <FormControl>
                <PasswordInput id="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm new password</FormLabel>
              <FormControl>
                <PasswordInput id="confirm-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? (
            <>
              <Loader2Icon className="size-4 animate-spin mr-2" />
              Updating...
            </>
          ) : (
            "Change Password"
          )}
        </Button>
      </form>
    </Form>
  )
}

function SetPasswordForm() {
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  const form = useForm<z.infer<typeof passwordFormSchema>>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
  })

  const onSubmit = async (values: z.infer<typeof passwordFormSchema>) => {
    if (!auth?.currentUser) return
    const email = getFirebaseEmail(auth.currentUser)
    if (!email) return

    setSaving(true)
    try {
      // Link email/password credential to the existing Google account
      const credential = EmailAuthProvider.credential(
        email,
        values.newPassword
      )
      await linkWithCredential(auth.currentUser, credential)

      // Sync with backend after linking
      await api.post("/auth/sync", { firebase_uid: auth.currentUser.uid })

      setSuccess(true)
      form.reset()
      setTimeout(() => setSuccess(false), 3000)
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to set password"
      form.setError("root", { type: "manual", message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Set a password to enable email/password sign-in alongside your Google account.
        </p>

        {form.formState.errors.root && (
          <p className="text-xs text-destructive">{form.formState.errors.root.message}</p>
        )}
        {success && (
          <p className="text-xs text-green-600 dark:text-green-400">
            Password set! You can now sign in with email and password.
          </p>
        )}

        <FormField
          control={form.control}
          name="newPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
              <FormControl>
                <PasswordInput id="set-password" placeholder="At least 6 characters" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm password</FormLabel>
              <FormControl>
                <PasswordInput id="set-confirm-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? (
            <>
              <Loader2Icon className="size-4 animate-spin mr-2" />
              Setting password...
            </>
          ) : (
            "Set Password"
          )}
        </Button>
      </form>
    </Form>
  )
}
