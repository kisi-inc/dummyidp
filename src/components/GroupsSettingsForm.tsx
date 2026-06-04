"use client";

import { z } from "zod";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { App } from "@/lib/app";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TrashIcon } from "@radix-ui/react-icons";
import { useUpsertApp } from "@/lib/hooks";

const formSchema = z.object({
  groups: z.array(
    z.object({
      displayName: z
        .string()
        .min(1, { message: "Group name is required" }),
      memberEmails: z.array(z.string()),
    }),
  ),
});

export function GroupsSettingsForm({ app }: { app: App }) {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      groups: app.groups ?? [],
    },
  });

  const { fields, remove, append } = useFieldArray({
    name: "groups",
    control: form.control,
  });

  // Members are chosen from the app's existing users, since a group can only
  // contain users that get synced over SCIM.
  const userEmails = (app.users ?? []).map((user) => user.email);

  const upsertApp = useUpsertApp();
  async function onSubmit(values: z.infer<typeof formSchema>) {
    await upsertApp.mutateAsync({
      ...app,
      groups: values.groups,
    });

    toast.success("App group settings updated");
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Group Name</TableHead>
              <TableHead>Members</TableHead>
              <TableHead className="w-[36px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((field, index) => (
              <TableRow key={field.id}>
                <TableCell className="align-top">
                  <FormField
                    control={form.control}
                    name={`groups.${index}.displayName`}
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input placeholder="Engineering" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TableCell>

                <TableCell className="align-top">
                  <FormField
                    control={form.control}
                    name={`groups.${index}.memberEmails`}
                    render={({ field }) => (
                      <FormItem>
                        {userEmails.length === 0 ? (
                          <div className="text-sm text-muted-foreground">
                            Add users first to assign members.
                          </div>
                        ) : (
                          <div className="grid gap-y-1">
                            {userEmails.map((email) => {
                              const checked = field.value?.includes(email);
                              return (
                                <Label
                                  key={email}
                                  className="flex items-center gap-2 font-normal"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      const next = e.target.checked
                                        ? [...(field.value ?? []), email]
                                        : (field.value ?? []).filter(
                                            (m) => m !== email,
                                          );
                                      field.onChange(next);
                                    }}
                                  />
                                  {email}
                                </Label>
                              );
                            })}
                          </div>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TableCell>

                <TableCell className="align-top">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => remove(index)}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => append({ displayName: "", memberEmails: [] })}
        >
          Add Group
        </Button>

        <div>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Saving" : "Save"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
