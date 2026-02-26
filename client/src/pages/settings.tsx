import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getLocalSettings, saveLocalSetting, deleteLocalSetting, type LocalSettings } from "@/lib/localSettings";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Save, Trash2, Eye, EyeOff, Settings, Key, Globe, Library, CreditCard, RefreshCw, Loader2 } from "lucide-react";

interface BillingData {
  Balance: number;
  BillingType: number;
  MonthlyChargesStorage?: number;
  MonthlyChargesEUTraffic?: number;
  MonthlyChargesUSTraffic?: number;
  MonthlyChargesASIATraffic?: number;
  MonthlyChargesSATraffic?: number;
  MonthlyChargesAFTraffic?: number;
  MonthlyChargesOCTraffic?: number;
  TrialBalance?: number;
  BillingFreeUntilDate?: string;
  [key: string]: any;
}

const SETTING_FIELDS = [
  { key: "account_api_key" as keyof LocalSettings, label: "Account API Key", icon: Key, placeholder: "Enter your Bunny.net account API key (for billing)", sensitive: true },
  { key: "api_key" as keyof LocalSettings, label: "Stream API Key", icon: Key, placeholder: "Enter your Bunny Stream library API key", sensitive: true },
  { key: "library_id" as keyof LocalSettings, label: "Library ID", icon: Library, placeholder: "Enter your Bunny Stream library ID", sensitive: false },
  { key: "download_domain" as keyof LocalSettings, label: "Download Domain", icon: Globe, placeholder: "e.g. vz-xxxxx.b-cdn.net", sensitive: false },
] as const;

export default function SettingsPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [formValues, setFormValues] = useState<Record<string, string>>(() => {
    const saved = getLocalSettings();
    return {
      account_api_key: saved.account_api_key || "",
      api_key: saved.api_key || "",
      library_id: saved.library_id || "",
      download_domain: saved.download_domain || "",
    };
  });
  const [saved, setSaved] = useState<Record<string, boolean>>(() => {
    const s = getLocalSettings();
    return {
      account_api_key: !!s.account_api_key,
      api_key: !!s.api_key,
      library_id: !!s.library_id,
      download_domain: !!s.download_domain,
    };
  });
  const [visibleFields, setVisibleFields] = useState<Record<string, boolean>>({});

  const billingQuery = useQuery<BillingData>({
    queryKey: ["/api/billing"],
    refetchInterval: 60000,
  });

  const handleSave = (key: keyof LocalSettings) => {
    const value = formValues[key]?.trim();
    if (!value) {
      toast({ title: "Value cannot be empty", variant: "destructive" });
      return;
    }
    saveLocalSetting(key, value);
    setSaved(prev => ({ ...prev, [key]: true }));
    queryClient.invalidateQueries({ queryKey: ["/api/billing"], refetchType: "all" });
    queryClient.invalidateQueries({ queryKey: ["/api/collections"], refetchType: "all" });
    queryClient.invalidateQueries({ queryKey: ["/api/videos"], refetchType: "all" });
    queryClient.invalidateQueries({ queryKey: ["/api/upload-config"], refetchType: "all" });
    toast({ title: `${SETTING_FIELDS.find(f => f.key === key)?.label} saved` });
  };

  const handleDelete = (key: keyof LocalSettings) => {
    deleteLocalSetting(key);
    setFormValues(prev => ({ ...prev, [key]: "" }));
    setSaved(prev => ({ ...prev, [key]: false }));
    queryClient.invalidateQueries({ queryKey: ["/api/billing"], refetchType: "all" });
    queryClient.invalidateQueries({ queryKey: ["/api/collections"], refetchType: "all" });
    queryClient.invalidateQueries({ queryKey: ["/api/videos"], refetchType: "all" });
    queryClient.invalidateQueries({ queryKey: ["/api/upload-config"], refetchType: "all" });
    toast({ title: `${SETTING_FIELDS.find(f => f.key === key)?.label} deleted` });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-3 flex items-center gap-4 bg-background sticky top-0 z-50">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation("/")}
          data-testid="button-back-to-dashboard"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Settings className="w-5 h-5" />
          <h1 className="text-lg font-semibold">Settings</h1>
        </div>
      </header>

      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <Card className="p-5" data-testid="card-billing">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Balance</Label>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => billingQuery.refetch()}
              disabled={billingQuery.isFetching}
              data-testid="button-refresh-billing"
            >
              {billingQuery.isFetching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </Button>
          </div>

          {billingQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading billing info...</div>
          ) : billingQuery.isError ? (
            <div className="text-sm text-muted-foreground">Unable to load billing info. Add your Account API Key below.</div>
          ) : billingQuery.data ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Balance</span>
                <span className="text-lg font-semibold" data-testid="text-balance">
                  ${billingQuery.data.Balance?.toFixed(2) ?? "0.00"}
                </span>
              </div>
              <Separator />
              {billingQuery.data.MonthlyChargesStorage !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Monthly Storage Charges</span>
                  <span className="text-sm" data-testid="text-monthly-storage">
                    ${billingQuery.data.MonthlyChargesStorage?.toFixed(2) ?? "0.00"}
                  </span>
                </div>
              )}
              {(() => {
                const trafficTotal = (billingQuery.data.MonthlyChargesEUTraffic || 0)
                  + (billingQuery.data.MonthlyChargesUSTraffic || 0)
                  + (billingQuery.data.MonthlyChargesASIATraffic || 0)
                  + (billingQuery.data.MonthlyChargesSATraffic || 0)
                  + (billingQuery.data.MonthlyChargesAFTraffic || 0)
                  + (billingQuery.data.MonthlyChargesOCTraffic || 0);
                return trafficTotal > 0 ? (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Monthly Traffic Charges</span>
                    <span className="text-sm" data-testid="text-monthly-traffic">
                      ${trafficTotal.toFixed(2)}
                    </span>
                  </div>
                ) : null;
              })()}
              {billingQuery.data.TrialBalance != null && billingQuery.data.TrialBalance > 0 && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Trial credits</span>
                    <span className="text-sm font-medium" data-testid="text-trial-balance">
                      ${billingQuery.data.TrialBalance.toFixed(2)}
                    </span>
                  </div>
                  {billingQuery.data.BillingFreeUntilDate && (
                    <div className="text-sm text-muted-foreground" data-testid="text-trial-date">
                      {(() => {
                        const endDate = new Date(billingQuery.data.BillingFreeUntilDate!);
                        const now = new Date();
                        const diffDays = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
                        return `Trial ends in ${diffDays} day${diffDays !== 1 ? "s" : ""}`;
                      })()}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : null}
        </Card>

        <Separator />

        {SETTING_FIELDS.map(field => {
          const hasValue = saved[field.key];

          return (
            <Card key={field.key} className="p-5">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <field.icon className="w-4 h-4 text-muted-foreground" />
                  <Label className="text-sm font-medium">{field.label}</Label>
                </div>
                {hasValue ? (
                  <Badge variant="secondary" data-testid={`badge-status-${field.key}`}>Configured</Badge>
                ) : (
                  <Badge variant="outline" data-testid={`badge-status-${field.key}`}>Not Set</Badge>
                )}
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    type={field.sensitive && !visibleFields[field.key] ? "password" : "text"}
                    value={formValues[field.key] || ""}
                    onChange={(e) => setFormValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    data-testid={`input-${field.key}`}
                  />
                </div>
                {field.sensitive && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setVisibleFields(prev => ({ ...prev, [field.key]: !prev[field.key] }))}
                    data-testid={`button-toggle-${field.key}-visibility`}
                  >
                    {visibleFields[field.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => handleSave(field.key)}
                  disabled={!formValues[field.key]?.trim()}
                  data-testid={`button-save-${field.key}`}
                >
                  <Save className="w-4 h-4 mr-1.5" />
                  Save
                </Button>
                {hasValue && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        data-testid={`button-delete-${field.key}`}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {field.label}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will remove the {field.label} from your browser. The app will stop working until you add it back.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDelete(field.key)}
                          data-testid={`button-confirm-delete-${field.key}`}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
