import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveSubAccountId } from "@/components/account-required";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { apiRequest } from "@/lib/queryClient";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  addMonths,
  subMonths,
  isToday,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight, Plus, Clock, MapPin, Trash2, Edit2, CalendarIcon, Loader2, RefreshCw } from "lucide-react";

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  scheduled: { bg: "bg-cyan-500/20 border-cyan-500/30", text: "text-cyan-400", dot: "bg-cyan-400" },
  completed: { bg: "bg-emerald-500/20 border-emerald-500/30", text: "text-emerald-400", dot: "bg-emerald-400" },
  cancelled: { bg: "bg-red-500/20 border-red-500/30", text: "text-red-400", dot: "bg-red-400" },
};

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Appointment {
  id: number;
  subAccountId: number;
  title: string;
  startTime: string;
  endTime: string;
  status: string;
  contactId?: number | null;
  description?: string | null;
  location?: string | null;
  googleCalendarEventId?: string | null;
  googleCalendarId?: string | null;
}

interface Contact {
  id: number;
  name: string;
  email?: string;
}

const emptyForm = {
  title: "",
  date: format(new Date(), "yyyy-MM-dd"),
  startTime: "09:00",
  endTime: "10:00",
  description: "",
  location: "",
  contactId: "",
  status: "scheduled",
};

export default function CalendarPage() {
  const subAccountId = useActiveSubAccountId();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: appointments = [], isLoading } = useQuery<Appointment[]>({
    queryKey: ["/api/appointments", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/appointments/${subAccountId}`);
      if (!res.ok) throw new Error("Failed to fetch appointments");
      return res.json();
    },
    enabled: !!subAccountId,
  });

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${subAccountId}`);
      if (!res.ok) throw new Error("Failed to fetch contacts");
      return res.json();
    },
    enabled: !!subAccountId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/appointments", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Created", description: "Appointment created successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments", subAccountId] });
      setShowNewDialog(false);
      setForm(emptyForm);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create appointment.", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/appointments/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Updated", description: "Appointment updated successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments", subAccountId] });
      setShowEditDialog(false);
      setEditingAppointment(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update appointment.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/appointments/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Deleted", description: "Appointment deleted." });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments", subAccountId] });
      setShowEditDialog(false);
      setEditingAppointment(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete appointment.", variant: "destructive" });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/calendar/sync/${subAccountId}`, { calendarId: "primary" });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Google Calendar Synced",
        description: `${data.created || 0} new, ${data.updated || 0} updated from Google Calendar`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments", subAccountId] });
    },
    onError: (err: any) => {
      toast({
        title: "Sync Failed",
        description: err?.message || "Could not sync Google Calendar. Make sure Google is connected in Integrations.",
        variant: "destructive",
      });
    },
  });

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const getAppointmentsForDay = (day: Date) =>
    appointments.filter((a) => isSameDay(new Date(a.startTime), day));

  const selectedDayAppointments = getAppointmentsForDay(selectedDay).sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  const handleCreate = () => {
    const startTime = new Date(`${form.date}T${form.startTime}:00`).toISOString();
    const endTime = new Date(`${form.date}T${form.endTime}:00`).toISOString();
    createMutation.mutate({
      subAccountId,
      title: form.title,
      startTime,
      endTime,
      status: form.status,
      description: form.description || undefined,
      location: form.location || undefined,
      contactId: form.contactId ? parseInt(form.contactId) : undefined,
    });
  };

  const handleUpdate = () => {
    if (!editingAppointment) return;
    const startTime = new Date(`${form.date}T${form.startTime}:00`).toISOString();
    const endTime = new Date(`${form.date}T${form.endTime}:00`).toISOString();
    updateMutation.mutate({
      id: editingAppointment.id,
      data: {
        title: form.title,
        startTime,
        endTime,
        status: form.status,
        description: form.description || undefined,
        location: form.location || undefined,
        contactId: form.contactId ? parseInt(form.contactId) : undefined,
      },
    });
  };

  const openEditDialog = (appt: Appointment) => {
    const start = new Date(appt.startTime);
    const end = new Date(appt.endTime);
    setEditingAppointment(appt);
    setForm({
      title: appt.title,
      date: format(start, "yyyy-MM-dd"),
      startTime: format(start, "HH:mm"),
      endTime: format(end, "HH:mm"),
      description: appt.description || "",
      location: appt.location || "",
      contactId: appt.contactId ? String(appt.contactId) : "",
      status: appt.status,
    });
    setShowEditDialog(true);
  };

  const openNewDialog = () => {
    setForm({ ...emptyForm, date: format(selectedDay, "yyyy-MM-dd") });
    setShowNewDialog(true);
  };

  const statusStyle = (status: string) => STATUS_STYLES[status] || STATUS_STYLES.scheduled;

  if (!subAccountId) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <p className="text-slate-200">Select a sub-account from the sidebar to continue.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 md:p-10 overflow-y-auto" data-testid="calendar-page">
      <div className="max-w-7xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 mb-4">
            <CalendarIcon size={12} /> CALENDAR
          </div>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <h1 className="text-3xl md:text-4xl font-black tracking-tight" data-testid="text-calendar-title">
              <span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">Calendar</span>
            </h1>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg p-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10"
                  data-testid="button-prev-month"
                >
                  <ChevronLeft size={16} />
                </Button>
                <span className="text-sm font-semibold text-white px-3 min-w-[140px] text-center" data-testid="text-current-month">
                  {format(currentMonth, "MMMM yyyy")}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10"
                  data-testid="button-next-month"
                >
                  <ChevronRight size={16} />
                </Button>
              </div>
              <Button
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                variant="outline"
                className="border-white/10 bg-white/5 text-white hover:bg-white/10 font-semibold"
                data-testid="button-sync-google-calendar"
              >
                <RefreshCw size={16} className={`mr-1 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                {syncMutation.isPending ? "Syncing..." : "Sync Google Calendar"}
              </Button>
              <Button
                onClick={openNewDialog}
                className="bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-semibold"
                data-testid="button-new-appointment"
              >
                <Plus size={16} className="mr-1" /> New Appointment
              </Button>
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card className="bg-white/5 border-white/10 overflow-hidden">
              <CardContent className="p-0">
                <div className="grid grid-cols-7">
                  {DAYS_OF_WEEK.map((day) => (
                    <div key={day} className="p-3 text-center text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-white/5">
                      {day}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7" data-testid="calendar-grid">
                  {calendarDays.map((day, i) => {
                    const dayAppts = getAppointmentsForDay(day);
                    const inMonth = isSameMonth(day, currentMonth);
                    const today = isToday(day);
                    const selected = isSameDay(day, selectedDay);
                    return (
                      <button
                        key={i}
                        onClick={() => setSelectedDay(day)}
                        className={`
                          relative min-h-[80px] md:min-h-[100px] p-2 text-left border-b border-r border-white/5 transition-colors
                          ${inMonth ? "hover:bg-white/[0.06]" : "opacity-40"}
                          ${selected ? "bg-indigo-500/10" : ""}
                          ${today ? "ring-1 ring-inset ring-cyan-400/60" : ""}
                        `}
                        data-testid={`calendar-day-${format(day, "yyyy-MM-dd")}`}
                      >
                        <span className={`text-sm font-semibold ${today ? "text-cyan-400" : inMonth ? "text-white" : "text-slate-400"}`}>
                          {format(day, "d")}
                        </span>
                        <div className="mt-1 space-y-0.5">
                          {dayAppts.slice(0, 3).map((a) => (
                            <div
                              key={a.id}
                              className={`flex items-center gap-1 px-1 py-0.5 rounded text-[10px] font-medium truncate ${statusStyle(a.status).bg} ${statusStyle(a.status).text} border`}
                              data-testid={`appointment-dot-${a.id}`}
                            >
                              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusStyle(a.status).dot}`} />
                              <span className="truncate">{a.title}</span>
                            </div>
                          ))}
                          {dayAppts.length > 3 && (
                            <div className="text-[10px] text-slate-300 pl-1">+{dayAppts.length - 3} more</div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <Card className="bg-white/5 border-white/10 sticky top-6">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold text-slate-300 flex items-center gap-2">
                  <CalendarIcon size={14} className="text-cyan-400" />
                  {format(selectedDay, "EEEE, MMMM d, yyyy")}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0" data-testid="appointment-list-panel">
                {isLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="animate-spin text-indigo-400" size={24} />
                  </div>
                ) : selectedDayAppointments.length === 0 ? (
                  <div className="text-center py-10">
                    <CalendarIcon size={40} className="mx-auto mb-3 text-white/10" />
                    <p className="text-slate-200 text-sm" data-testid="text-no-appointments">No appointments</p>
                    <p className="text-slate-400 text-xs mt-1">Click "New Appointment" to schedule one</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                    {selectedDayAppointments.map((appt) => {
                      const ss = statusStyle(appt.status);
                      return (
                        <button
                          key={appt.id}
                          onClick={() => openEditDialog(appt)}
                          className="w-full text-left p-3 rounded-lg bg-white/[0.03] border border-white/5 hover:bg-white/[0.08] transition-colors group"
                          data-testid={`appointment-item-${appt.id}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-semibold text-white truncate" data-testid={`appointment-title-${appt.id}`}>{appt.title}</span>
                                {appt.googleCalendarEventId && (
                                  <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">GCal</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 mt-1 text-xs text-slate-400">
                                <Clock size={10} />
                                <span data-testid={`appointment-time-${appt.id}`}>
                                  {format(new Date(appt.startTime), "h:mm a")} – {format(new Date(appt.endTime), "h:mm a")}
                                </span>
                              </div>
                              {appt.location && (
                                <div className="flex items-center gap-1 mt-0.5 text-xs text-slate-300">
                                  <MapPin size={10} />
                                  <span>{appt.location}</span>
                                </div>
                              )}
                            </div>
                            <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${ss.bg} ${ss.text}`} data-testid={`appointment-status-${appt.id}`}>
                              {appt.status}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>

      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="bg-slate-900 border-white/10 text-white max-w-md" data-testid="dialog-new-appointment">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">New Appointment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
              data-testid="input-appointment-title"
            />
            <Input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="bg-white/5 border-white/10 text-white"
              data-testid="input-appointment-date"
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Start Time</label>
                <Input
                  type="time"
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                  className="bg-white/5 border-white/10 text-white"
                  data-testid="input-appointment-start-time"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">End Time</label>
                <Input
                  type="time"
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                  className="bg-white/5 border-white/10 text-white"
                  data-testid="input-appointment-end-time"
                />
              </div>
            </div>
            <Input
              placeholder="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
              data-testid="input-appointment-description"
            />
            <Input
              placeholder="Location"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
              data-testid="input-appointment-location"
            />
            <Select value={form.contactId} onValueChange={(v) => setForm({ ...form, contactId: v })}>
              <SelectTrigger className="bg-white/5 border-white/10 text-white" data-testid="select-appointment-contact">
                <SelectValue placeholder="Select contact (optional)" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-white/10">
                {contacts.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)} className="text-white hover:bg-white/10">
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="bg-white/5 border-white/10 text-white" data-testid="select-appointment-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-white/10">
                <SelectItem value="scheduled" className="text-cyan-400 hover:bg-white/10">Scheduled</SelectItem>
                <SelectItem value="completed" className="text-emerald-400 hover:bg-white/10">Completed</SelectItem>
                <SelectItem value="cancelled" className="text-red-400 hover:bg-white/10">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={handleCreate}
              disabled={!form.title || createMutation.isPending}
              className="w-full bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-semibold"
              data-testid="button-create-appointment"
            >
              {createMutation.isPending ? <Loader2 size={16} className="animate-spin mr-2" /> : <Plus size={16} className="mr-2" />}
              Create Appointment
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="bg-slate-900 border-white/10 text-white max-w-md" data-testid="dialog-edit-appointment">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Edit Appointment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
              data-testid="input-edit-title"
            />
            <Input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="bg-white/5 border-white/10 text-white"
              data-testid="input-edit-date"
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Start Time</label>
                <Input
                  type="time"
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                  className="bg-white/5 border-white/10 text-white"
                  data-testid="input-edit-start-time"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">End Time</label>
                <Input
                  type="time"
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                  className="bg-white/5 border-white/10 text-white"
                  data-testid="input-edit-end-time"
                />
              </div>
            </div>
            <Input
              placeholder="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
              data-testid="input-edit-description"
            />
            <Input
              placeholder="Location"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
              data-testid="input-edit-location"
            />
            <Select value={form.contactId} onValueChange={(v) => setForm({ ...form, contactId: v })}>
              <SelectTrigger className="bg-white/5 border-white/10 text-white" data-testid="select-edit-contact">
                <SelectValue placeholder="Select contact (optional)" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-white/10">
                {contacts.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)} className="text-white hover:bg-white/10">
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="bg-white/5 border-white/10 text-white" data-testid="select-edit-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-white/10">
                <SelectItem value="scheduled" className="text-cyan-400 hover:bg-white/10">Scheduled</SelectItem>
                <SelectItem value="completed" className="text-emerald-400 hover:bg-white/10">Completed</SelectItem>
                <SelectItem value="cancelled" className="text-red-400 hover:bg-white/10">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button
                onClick={handleUpdate}
                disabled={!form.title || updateMutation.isPending}
                className="flex-1 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-semibold"
                data-testid="button-update-appointment"
              >
                {updateMutation.isPending ? <Loader2 size={16} className="animate-spin mr-2" /> : <Edit2 size={16} className="mr-2" />}
                Update
              </Button>
              <Button
                onClick={() => editingAppointment && deleteMutation.mutate(editingAppointment.id)}
                disabled={deleteMutation.isPending}
                variant="destructive"
                className="bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-500/30"
                data-testid="button-delete-appointment"
              >
                {deleteMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
