using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Windows 10+: atomic creation-time Job membership closes the suspended/assign
// crash gap. No BREAKAWAY flags; Job and control-input handles are never inherited.
public static class ContextModeWindowsJob {
    [StructLayout(LayoutKind.Sequential)] struct BasicLimit {
        public long PerProcessTime, PerJobTime; public uint Flags;
        public UIntPtr MinWorking, MaxWorking; public uint ActiveLimit;
        public UIntPtr Affinity; public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong A,B,C,D,E,F; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit {
        public BasicLimit Basic; public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] struct Accounting {
        public long A,B,C,D; public uint PageFaults, Total, Active, Terminated;
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
        public uint Size; public string Reserved, Desktop, Title;
        public uint X,Y,Width,Height,XChars,YChars,Fill,Flags;
        public ushort Show, ReservedSize; public IntPtr ReservedData, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup Startup; public IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
    [StructLayout(LayoutKind.Sequential)] struct Security { public uint Size; public IntPtr Descriptor; public int Inherit; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr security, string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref ExtendedLimit info, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int type, out Accounting info, uint size, IntPtr length);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcessW(string exe, StringBuilder command, IntPtr psa, IntPtr tsa, bool inherit, uint flags, IntPtr env, string cwd, ref StartupEx startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr GetStdHandle(int which);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool PeekNamedPipe(IntPtr pipe, IntPtr buffer, uint size, IntPtr read, out uint available, IntPtr remaining);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFileW(string name, uint access, uint sharing, ref Security security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    static void Check(bool ok, string operation) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error(), operation); }
    static bool ControlClosed() {
        uint available;
        if (PeekNamedPipe(GetStdHandle(-10),IntPtr.Zero,0,IntPtr.Zero,out available,IntPtr.Zero)) return false;
        int error=Marshal.GetLastWin32Error();
        if (error==109 || error==232) return true; // broken/disconnected control pipe
        throw new Win32Exception(error,"control-pipe status");
    }
    static IntPtr Handles(params IntPtr[] handles) {
        IntPtr memory = Marshal.AllocHGlobal(handles.Length * IntPtr.Size);
        for (int i=0; i<handles.Length; i++) Marshal.WriteIntPtr(memory, i*IntPtr.Size, handles[i]);
        return memory;
    }
    public static int Run(string exe, string command, string cwd, string environment, string name, bool terminateDescendants) {
        IntPtr job=IntPtr.Zero, nul=IntPtr.Zero, attributes=IntPtr.Zero, jobs=IntPtr.Zero, handles=IntPtr.Zero, env=IntPtr.Zero;
        ProcessInfo process = new ProcessInfo(); bool attributesInitialized=false, created=false;
        try {
            job=CreateJobObjectW(IntPtr.Zero, String.IsNullOrEmpty(name) ? null : name);
            int jobError=Marshal.GetLastWin32Error();
            Check(job != IntPtr.Zero, "CreateJobObject");
            if (!String.IsNullOrEmpty(name) && jobError==183) {
                // Existing Job belongs to another repair. Never configure/terminate it.
                Console.Error.WriteLine("[context-mode job] repair inflight"); return 75;
            }
            ExtendedLimit limit=new ExtendedLimit(); limit.Basic.Flags=0x2000; // KILL_ON_JOB_CLOSE
            Check(SetInformationJobObject(job, 9, ref limit, (uint)Marshal.SizeOf(typeof(ExtendedLimit))), "SetInformationJobObject");
            Security security=new Security(); security.Size=(uint)Marshal.SizeOf(typeof(Security)); security.Inherit=1;
            nul=CreateFileW("NUL", 0x80000000, 3, ref security, 3, 0, IntPtr.Zero);
            Check(nul != new IntPtr(-1), "CreateFile(NUL)");
            IntPtr output=GetStdHandle(-11), error=GetStdHandle(-12);
            Check(SetHandleInformation(output,1,1), "stdout inheritance");
            Check(SetHandleInformation(error,1,1), "stderr inheritance");
            IntPtr size=IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref size);
            Check(size != IntPtr.Zero, "attribute-list size");
            attributes=Marshal.AllocHGlobal(size);
            Check(InitializeProcThreadAttributeList(attributes,2,0,ref size), "attribute-list initialization"); attributesInitialized=true;
            jobs=Handles(job); handles=Handles(nul,output,error);
            Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x2000D),jobs,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero), "Job-list attribute (Windows 10+ required)");
            Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x20002),handles,new IntPtr(3*IntPtr.Size),IntPtr.Zero,IntPtr.Zero), "handle-list attribute");
            env=Marshal.StringToHGlobalUni(environment);
            StartupEx startup=new StartupEx(); startup.Startup.Size=(uint)Marshal.SizeOf(typeof(StartupEx));
            startup.Startup.Flags=0x100; startup.Startup.Input=nul; startup.Startup.Output=output; startup.Startup.Error=error; startup.Attributes=attributes;
            // Query the actual pipe synchronously: a delayed reader task could
            // miss EOF already received during managed compilation.
            if (ControlClosed()) return 1;
            // Membership is atomic with creation, including inherited outer Jobs.
            // Assignment/nesting failure creates no runnable or unowned child.
            Check(CreateProcessW(exe,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,true,0x08080404,env,cwd,ref startup,out process), "CreateProcess with Job membership");
            created=true;
            bool stopped=false, rootExited=false; uint exit=1;
            if (ControlClosed()) { Check(TerminateJobObject(job,1), "cancel suspended Job"); stopped=true; }
            else Check(ResumeThread(process.Thread) != UInt32.MaxValue, "ResumeThread");
            while (true) {
                if (!rootExited && WaitForSingleObject(process.Process,0)==0) {
                    Check(GetExitCodeProcess(process.Process,out exit), "GetExitCodeProcess"); rootExited=true;
                }
                if (!stopped && (ControlClosed() || (terminateDescendants && rootExited))) {
                    Check(TerminateJobObject(job,1), "TerminateJobObject"); stopped=true;
                }
                Accounting accounting;
                Check(QueryInformationJobObject(job,1,out accounting,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero), "QueryInformationJobObject");
                if (accounting.Active==0) {
                    Check(WaitForSingleObject(process.Process,1000)==0, "root termination confirmation");
                    Check(GetExitCodeProcess(process.Process,out exit), "GetExitCodeProcess");
                    return unchecked((int)exit);
                }
                Thread.Sleep(10);
            }
        } catch (Win32Exception error) {
            Console.Error.WriteLine("[context-mode job] " + error.Message + " (" + error.NativeErrorCode + ")");
            return 1;
        } finally {
            // On any failure after creation only this Job is terminated. Never
            // reopen by PID, taskkill by name, or alter a pre-existing named Job.
            if (created && job != IntPtr.Zero) {
                TerminateJobObject(job,1);
                Accounting remaining;
                while (QueryInformationJobObject(job,1,out remaining,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero) && remaining.Active != 0) Thread.Sleep(10);
            }
            if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
            if (process.Process != IntPtr.Zero) CloseHandle(process.Process);
            if (attributesInitialized) DeleteProcThreadAttributeList(attributes);
            foreach (IntPtr memory in new[]{attributes,jobs,handles,env}) if (memory != IntPtr.Zero) Marshal.FreeHGlobal(memory);
            if (nul != IntPtr.Zero && nul != new IntPtr(-1)) CloseHandle(nul);
            if (job != IntPtr.Zero) CloseHandle(job);
        }
    }
}
